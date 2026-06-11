/**
 * Tests for the ExecutionBackend abstraction:
 *   - LocalBackend (real execution)
 *   - DockerBackend (mocked spawn)
 *   - SshBackend (mocked spawn + shellQuote unit tests)
 *   - Factory / singleton (getExecutionBackend, _resetExecutionBackendForTests)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Mock child_process.spawn for docker/ssh tests
// ---------------------------------------------------------------------------

// We keep a mutable reference to what the mock should do so individual tests
// can control it without calling jest.spyOn after import resolution.
let _spawnMockImpl: ((cmd: string, args: readonly string[], opts?: unknown) => unknown) | null = null;

jest.mock('node:child_process', () => {
  const actual = jest.requireActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: jest.fn((...a: Parameters<typeof actual.spawn>) => {
      if (_spawnMockImpl) return _spawnMockImpl(a[0], a[1] as readonly string[], a[2]);
      // Fall through to real spawn for LocalBackend tests
      return actual.spawn(...a);
    }),
  };
});

import { spawn } from 'node:child_process';
const spawnMock = spawn as jest.MockedFunction<typeof spawn>;

import { LocalBackend } from '../../lib/execution/localBackend';
import { DockerBackend, createDockerBackend } from '../../lib/execution/dockerBackend';
import { SshBackend, shellQuote } from '../../lib/execution/sshBackend';
import {
  getExecutionBackend,
  _resetExecutionBackendForTests,
} from '../../lib/execution/index';

// ---------------------------------------------------------------------------
// Helper: build a fake ChildProcess-like object
// ---------------------------------------------------------------------------

function makeFakeChild(
  stdout: string,
  stderr: string,
  exitCode: number,
  stdinChunks?: string[],
) {
  const stdoutListeners: Array<(d: Buffer) => void> = [];
  const stderrListeners: Array<(d: Buffer) => void> = [];
  const closeListeners: Array<(code: number | null) => void> = [];

  const child = {
    stdout: {
      on(ev: string, fn: (d: Buffer) => void) {
        if (ev === 'data') stdoutListeners.push(fn);
        return this;
      },
    },
    stderr: {
      on(ev: string, fn: (d: Buffer) => void) {
        if (ev === 'data') stderrListeners.push(fn);
        return this;
      },
    },
    stdin: {
      write(chunk: string | Buffer, _enc?: string) {
        if (stdinChunks !== undefined && typeof chunk === 'string') stdinChunks.push(chunk);
      },
      end() { /* noop */ },
    },
    on(ev: string, fn: (...a: unknown[]) => void) {
      if (ev === 'close') closeListeners.push(fn as (code: number | null) => void);
      return this;
    },
    kill: jest.fn(),
  };

  setImmediate(() => {
    for (const fn of stdoutListeners) fn(Buffer.from(stdout));
    for (const fn of stderrListeners) fn(Buffer.from(stderr));
    for (const fn of closeListeners) fn(exitCode);
  });

  return child;
}

// ---------------------------------------------------------------------------
// shellQuote
// ---------------------------------------------------------------------------

describe('shellQuote', () => {
  it('wraps a plain string in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'");
  });

  it('handles empty string', () => {
    expect(shellQuote('')).toBe("''");
  });

  it('escapes embedded single quotes', () => {
    // "it's" → 'it'"'"'s'
    expect(shellQuote("it's")).toBe("'it'\"'\"'s'");
  });

  it('handles string with spaces', () => {
    expect(shellQuote('hello world')).toBe("'hello world'");
  });

  it('handles multiple single quotes', () => {
    // "a'b'c" → 'a'"'"'b'"'"'c'
    expect(shellQuote("a'b'c")).toBe("'a'\"'\"'b'\"'\"'c'");
  });
});

// ---------------------------------------------------------------------------
// LocalBackend — real execution (spawn not mocked)
// ---------------------------------------------------------------------------

describe('LocalBackend', () => {
  let tmpDir: string;
  let backend: LocalBackend;

  beforeEach(() => {
    _spawnMockImpl = null; // use real spawn
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-local-'));
    process.env.SKILL_FILE_SANDBOX_DIR = tmpDir;
    backend = new LocalBackend();
  });

  afterEach(() => {
    delete process.env.SKILL_FILE_SANDBOX_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs echo hello and returns stdout', async () => {
    if (process.platform === 'win32') return; // skip on Windows
    const result = await backend.runCommand({ command: 'echo', args: ['hello'] });
    expect(result.backend).toBe('local');
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('writes a file to the sandbox', async () => {
    const result = await backend.writeFile({ relativePath: 'test.txt', content: 'hello world' });
    expect(result.backend).toBe('local');
    expect(result.bytesWritten).toBe(11);
    const diskContent = fs.readFileSync(result.path, 'utf8');
    expect(diskContent).toBe('hello world');
  });

  it('appends to a file', async () => {
    await backend.writeFile({ relativePath: 'append.txt', content: 'line1\n' });
    await backend.writeFile({ relativePath: 'append.txt', content: 'line2\n', append: true });
    const diskContent = fs.readFileSync(path.join(tmpDir, 'append.txt'), 'utf8');
    expect(diskContent).toBe('line1\nline2\n');
  });

  it('rejects paths outside sandbox', async () => {
    await expect(backend.writeFile({ relativePath: '../escape.txt', content: 'x' }))
      .rejects.toThrow(/outside the allowed sandbox/);
  });

  it('describe returns local kind', () => {
    const desc = backend.describe();
    expect(desc.kind).toBe('local');
    expect(typeof desc.workingDir).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// DockerBackend — mocked spawn
// ---------------------------------------------------------------------------

describe('DockerBackend', () => {
  let capturedArgv: { cmd: string; args: string[] }[];

  beforeEach(() => {
    capturedArgv = [];
  });

  afterEach(() => {
    _spawnMockImpl = null;
    spawnMock.mockClear();
    _resetExecutionBackendForTests();
    delete process.env.EXECUTION_DOCKER_CONTAINER;
  });

  it('throws if EXECUTION_DOCKER_CONTAINER is missing', () => {
    delete process.env.EXECUTION_DOCKER_CONTAINER;
    expect(() => createDockerBackend()).toThrow(/EXECUTION_DOCKER_CONTAINER/);
  });

  function makeBackend(container = 'my-container', workdir = '/workspace', envAllowlist: string[] = []) {
    return new DockerBackend(container, workdir, envAllowlist, 5000);
  }

  function setupMock(stdout = '', stderr = '', exitCode = 0) {
    _spawnMockImpl = (cmd, args) => {
      capturedArgv.push({ cmd: String(cmd), args: [...args] });
      return makeFakeChild(stdout, stderr, exitCode);
    };
  }

  it('constructs correct docker exec argv', async () => {
    setupMock('hi\n');
    const backend = makeBackend();
    const result = await backend.runCommand({ command: 'echo', args: ['hi'] });
    expect(result.backend).toBe('docker');
    expect(capturedArgv).toHaveLength(1);
    const { cmd, args } = capturedArgv[0];
    expect(cmd).toBe('docker');
    expect(args[0]).toBe('exec');
    expect(args).toContain('-w');
    expect(args).toContain('/workspace');
    expect(args).toContain('my-container');
    expect(args).toContain('echo');
    expect(args).toContain('hi');
  });

  it('forwards allowlisted env vars that are set', async () => {
    process.env.MY_TEST_VAR = 'secret';
    setupMock();
    const backend = makeBackend('c1', '/workspace', ['MY_TEST_VAR', 'UNSET_VAR']);
    await backend.runCommand({ command: 'echo', args: [] });
    const { args } = capturedArgv[0];
    const eIdx = args.indexOf('-e');
    expect(eIdx).toBeGreaterThan(-1);
    expect(args[eIdx + 1]).toBe('MY_TEST_VAR=secret');
    expect(args.join(' ')).not.toContain('UNSET_VAR');
    delete process.env.MY_TEST_VAR;
  });

  it('writeFile append:true uses docker exec -i ... sh -c "cat >>" instead of docker cp', async () => {
    const stdinChunks: string[] = [];
    _spawnMockImpl = (cmd, args) => {
      capturedArgv.push({ cmd: String(cmd), args: [...args] });
      return makeFakeChild('', '', 0, stdinChunks);
    };
    const backend = makeBackend();
    const result = await backend.writeFile({ relativePath: 'sub/file.txt', content: 'appended', append: true });
    expect(result.backend).toBe('docker');
    expect(result.bytesWritten).toBe(8);
    // First call: mkdir -p; second: docker exec -i ... sh -c 'cat >>'
    expect(capturedArgv).toHaveLength(2);
    const [mkdirCall, appendCall] = capturedArgv;
    expect(mkdirCall.cmd).toBe('docker');
    expect(mkdirCall.args).toContain('mkdir');
    expect(appendCall.cmd).toBe('docker');
    expect(appendCall.args).toContain('exec');
    expect(appendCall.args).toContain('-i');
    expect(appendCall.args).toContain('sh');
    expect(appendCall.args).toContain('-c');
    const shCmd = appendCall.args[appendCall.args.indexOf('-c') + 1];
    expect(shCmd).toContain('cat >>');
    // docker cp must NOT be used
    expect(capturedArgv.every(({ args }) => args[0] !== 'cp')).toBe(true);
    // content must be streamed via stdin
    expect(stdinChunks.join('')).toBe('appended');
  });

  it('writeFile overwrite (append omitted) still uses docker cp', async () => {
    setupMock();
    const backend = makeBackend();
    await backend.writeFile({ relativePath: 'sub/file.txt', content: 'hello' });
    // First call: mkdir -p; second: docker cp
    expect(capturedArgv).toHaveLength(2);
    const cpCall = capturedArgv[1];
    expect(cpCall.args[0]).toBe('cp');
  });

  it('rejects absolute path', async () => {
    const backend = makeBackend();
    await expect(backend.writeFile({ relativePath: '/absolute/path.txt', content: 'hi' }))
      .rejects.toThrow(/must be relative/);
  });

  it('rejects .. segments', async () => {
    const backend = makeBackend();
    await expect(backend.writeFile({ relativePath: '../x.txt', content: 'hi' }))
      .rejects.toThrow(/must not contain '\.\.'/);
  });

  it('writeFile calls docker cp with a temp file', async () => {
    setupMock();
    const backend = makeBackend();
    const result = await backend.writeFile({ relativePath: 'sub/file.txt', content: 'hello' });
    expect(result.backend).toBe('docker');
    expect(result.bytesWritten).toBe(5);
    // First call: mkdir -p; second: docker cp
    expect(capturedArgv).toHaveLength(2);
    const [mkdirCall, cpCall] = capturedArgv;
    expect(mkdirCall.cmd).toBe('docker');
    expect(mkdirCall.args).toContain('mkdir');
    expect(cpCall.args[0]).toBe('cp');
    expect(cpCall.args[cpCall.args.length - 1]).toBe('my-container:/workspace/sub/file.txt');
  });
});

// ---------------------------------------------------------------------------
// SshBackend — mocked spawn
// ---------------------------------------------------------------------------

describe('SshBackend', () => {
  let capturedArgv: { cmd: string; args: string[] }[];

  beforeEach(() => {
    capturedArgv = [];
  });

  afterEach(() => {
    _spawnMockImpl = null;
    spawnMock.mockClear();
  });

  function makeBackend(overrides: Partial<{
    host: string; user: string; port: string; identityFile: string; workdir: string; envAllowlist: string[]
  }> = {}) {
    return new SshBackend({
      host: overrides.host ?? 'example.com',
      user: overrides.user,
      port: overrides.port,
      identityFile: overrides.identityFile,
      workdir: overrides.workdir ?? '~',
      envAllowlist: overrides.envAllowlist ?? [],
      defaultTimeoutMs: 5000,
    });
  }

  function setupMock(stdout = '', stderr = '', exitCode = 0, stdinChunks?: string[]) {
    _spawnMockImpl = (cmd, args) => {
      capturedArgv.push({ cmd: String(cmd), args: [...args] });
      return makeFakeChild(stdout, stderr, exitCode, stdinChunks);
    };
  }

  it('constructs basic ssh argv with host', async () => {
    setupMock('out\n');
    const backend = makeBackend();
    await backend.runCommand({ command: 'echo', args: ['hi'] });
    const { cmd, args } = capturedArgv[0];
    expect(cmd).toBe('ssh');
    expect(args).toContain('example.com');
    expect(args).toContain('--');
  });

  it('includes user@host when user is set', async () => {
    setupMock();
    const backend = makeBackend({ user: 'ubuntu' });
    await backend.runCommand({ command: 'pwd', args: [] });
    const dest = capturedArgv[0].args.find((a) => a.includes('@'));
    expect(dest).toBe('ubuntu@example.com');
  });

  it('includes -p flag when port is set', async () => {
    setupMock();
    const backend = makeBackend({ port: '2222' });
    await backend.runCommand({ command: 'pwd', args: [] });
    const { args } = capturedArgv[0];
    expect(args).toContain('-p');
    expect(args[args.indexOf('-p') + 1]).toBe('2222');
  });

  it('includes -i flag when identityFile is set', async () => {
    setupMock();
    const backend = makeBackend({ identityFile: '/home/user/.ssh/id_rsa' });
    await backend.runCommand({ command: 'pwd', args: [] });
    const { args } = capturedArgv[0];
    expect(args).toContain('-i');
    expect(args[args.indexOf('-i') + 1]).toBe('/home/user/.ssh/id_rsa');
  });

  it('writeFile append:true uses cat >> in remote command', async () => {
    setupMock();
    const backend = makeBackend({ workdir: '/remote' });
    const result = await backend.writeFile({ relativePath: 'notes.txt', content: 'more data', append: true });
    expect(result.backend).toBe('ssh');
    expect(result.bytesWritten).toBe(9);
    const remoteCmd = capturedArgv[0].args[capturedArgv[0].args.length - 1];
    expect(remoteCmd).toContain('cat >>');
    // must NOT use single > (overwrite redirect)
    expect(remoteCmd).not.toMatch(/cat >(?!>)/);
  });

  it('writeFile overwrite (append omitted) uses cat > in remote command', async () => {
    setupMock();
    const backend = makeBackend({ workdir: '/remote' });
    await backend.writeFile({ relativePath: 'notes.txt', content: 'data' });
    const remoteCmd = capturedArgv[0].args[capturedArgv[0].args.length - 1];
    // should contain single > but NOT >>
    expect(remoteCmd).toMatch(/cat >/);
    expect(remoteCmd).not.toContain('cat >>');
  });

  it('rejects absolute paths in writeFile', async () => {
    const backend = makeBackend();
    await expect(backend.writeFile({ relativePath: '/abs/path.txt', content: 'hi' }))
      .rejects.toThrow(/must be relative/);
  });

  it('rejects .. segments in writeFile', async () => {
    const backend = makeBackend();
    await expect(backend.writeFile({ relativePath: '../escape.txt', content: 'hi' }))
      .rejects.toThrow(/must not contain '\.\.'/);
  });

  it('writeFile pipes content via stdin', async () => {
    const stdinChunks: string[] = [];
    setupMock('', '', 0, stdinChunks);
    const backend = makeBackend({ workdir: '/remote' });
    await backend.writeFile({ relativePath: 'notes.txt', content: 'hello ssh' });
    expect(stdinChunks.join('')).toBe('hello ssh');
  });

  it('remote command includes cd and cat >target', async () => {
    setupMock();
    const backend = makeBackend({ workdir: '/remote' });
    await backend.writeFile({ relativePath: 'notes.txt', content: 'data' });
    const remoteCmd = capturedArgv[0].args[capturedArgv[0].args.length - 1];
    expect(remoteCmd).toContain('mkdir -p');
    expect(remoteCmd).toContain('cat >');
  });

  it('does not quote a literal ~ for the default workdir', async () => {
    setupMock();
    const backend = makeBackend(); // workdir: '~'
    await backend.runCommand({ command: 'pwd', args: [] });
    const remoteCmd = capturedArgv[0].args[capturedArgv[0].args.length - 1];
    // Quoting '~' would defeat tilde expansion on the remote shell;
    // '~' maps to '.' because ssh commands start in the home directory.
    expect(remoteCmd).not.toContain("'~'");
    expect(remoteCmd).toContain("cd '.'");
  });

  it('writes top-level files relative to home for the default workdir', async () => {
    setupMock();
    const backend = makeBackend(); // workdir: '~'
    await backend.writeFile({ relativePath: 'notes.txt', content: 'data' });
    const remoteCmd = capturedArgv[0].args[capturedArgv[0].args.length - 1];
    expect(remoteCmd).toContain("mkdir -p '.'");
    expect(remoteCmd).toContain("cat > 'notes.txt'");
    expect(remoteCmd).not.toContain('~');
  });

  it('maps a ~/sub workdir to a home-relative path', async () => {
    setupMock();
    const backend = makeBackend({ workdir: '~/sub' });
    await backend.writeFile({ relativePath: 'a/b.txt', content: 'data' });
    const remoteCmd = capturedArgv[0].args[capturedArgv[0].args.length - 1];
    expect(remoteCmd).toContain("mkdir -p 'sub/a'");
    expect(remoteCmd).toContain("cat > 'sub/a/b.txt'");
    expect(remoteCmd).not.toContain('~');
  });
});

// ---------------------------------------------------------------------------
// Factory / singleton
// ---------------------------------------------------------------------------

describe('getExecutionBackend (factory)', () => {
  beforeEach(() => {
    _spawnMockImpl = null;
    _resetExecutionBackendForTests();
  });

  afterEach(() => {
    _resetExecutionBackendForTests();
    delete process.env.EXECUTION_BACKEND;
    delete process.env.EXECUTION_DOCKER_CONTAINER;
    delete process.env.EXECUTION_SSH_HOST;
  });

  it('defaults to local backend', () => {
    delete process.env.EXECUTION_BACKEND;
    const b = getExecutionBackend();
    expect(b.kind).toBe('local');
  });

  it('returns cached instance on second call', () => {
    const b1 = getExecutionBackend();
    const b2 = getExecutionBackend();
    expect(b1).toBe(b2);
  });

  it('_resetExecutionBackendForTests clears cache', () => {
    const b1 = getExecutionBackend();
    _resetExecutionBackendForTests();
    const b2 = getExecutionBackend();
    expect(b1).not.toBe(b2);
  });

  it('switches to docker backend when EXECUTION_BACKEND=docker', () => {
    process.env.EXECUTION_BACKEND = 'docker';
    process.env.EXECUTION_DOCKER_CONTAINER = 'test-container';
    const b = getExecutionBackend();
    expect(b.kind).toBe('docker');
  });

  it('switches to ssh backend when EXECUTION_BACKEND=ssh', () => {
    process.env.EXECUTION_BACKEND = 'ssh';
    process.env.EXECUTION_SSH_HOST = 'myserver.example.com';
    const b = getExecutionBackend();
    expect(b.kind).toBe('ssh');
  });

  it('falls back to local on unknown backend value and warns', () => {
    process.env.EXECUTION_BACKEND = 'kubernetes';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const b = getExecutionBackend();
    expect(b.kind).toBe('local');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('kubernetes'));
    warnSpy.mockRestore();
  });
});
