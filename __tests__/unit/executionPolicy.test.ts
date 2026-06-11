/**
 * Tests for lib/execution/policy.ts and its integration with LocalBackend.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Prevent real spawn from interfering; LocalBackend tests use real spawn below.
let _spawnMockImpl: ((cmd: string, args: readonly string[], opts?: unknown) => unknown) | null = null;

jest.mock('node:child_process', () => {
  const actual = jest.requireActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: jest.fn((...a: Parameters<typeof actual.spawn>) => {
      if (_spawnMockImpl) return _spawnMockImpl(a[0], a[1] as readonly string[], a[2]);
      return actual.spawn(...a);
    }),
  };
});

import {
  getAllowedPathPrefixes,
  enforceAllowedPath,
  getNetworkPolicy,
  enforceNetworkPolicy,
} from '../../lib/execution/policy';
import { LocalBackend } from '../../lib/execution/localBackend';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------
// getAllowedPathPrefixes
// ---------------------------------------------------------------------------

describe('getAllowedPathPrefixes', () => {
  afterEach(() => {
    delete process.env.EXECUTION_ALLOWED_PATHS;
  });

  it('returns null when EXECUTION_ALLOWED_PATHS is not set', () => {
    delete process.env.EXECUTION_ALLOWED_PATHS;
    expect(getAllowedPathPrefixes()).toBeNull();
  });

  it('returns null for empty string', () => {
    process.env.EXECUTION_ALLOWED_PATHS = '';
    expect(getAllowedPathPrefixes()).toBeNull();
  });

  it('returns null when all entries are blank after trim', () => {
    process.env.EXECUTION_ALLOWED_PATHS = ' , , ';
    expect(getAllowedPathPrefixes()).toBeNull();
  });

  it('normalises leading ./ from each prefix', () => {
    process.env.EXECUTION_ALLOWED_PATHS = './outputs,./reports/daily';
    expect(getAllowedPathPrefixes()).toEqual(['outputs', 'reports/daily']);
  });

  it('normalises trailing / from each prefix', () => {
    process.env.EXECUTION_ALLOWED_PATHS = 'outputs/,reports/daily/';
    expect(getAllowedPathPrefixes()).toEqual(['outputs', 'reports/daily']);
  });

  it('trims whitespace around entries', () => {
    process.env.EXECUTION_ALLOWED_PATHS = '  outputs , reports/daily  ';
    expect(getAllowedPathPrefixes()).toEqual(['outputs', 'reports/daily']);
  });

  it('returns a parsed list for valid entries', () => {
    process.env.EXECUTION_ALLOWED_PATHS = 'outputs,reports/daily';
    expect(getAllowedPathPrefixes()).toEqual(['outputs', 'reports/daily']);
  });
});

// ---------------------------------------------------------------------------
// enforceAllowedPath
// ---------------------------------------------------------------------------

describe('enforceAllowedPath', () => {
  afterEach(() => {
    delete process.env.EXECUTION_ALLOWED_PATHS;
  });

  it('allows anything when allowlist is null (unrestricted)', () => {
    delete process.env.EXECUTION_ALLOWED_PATHS;
    expect(() => enforceAllowedPath('anything/deep/path.txt')).not.toThrow();
  });

  it('allows exact prefix match', () => {
    process.env.EXECUTION_ALLOWED_PATHS = 'outputs';
    expect(() => enforceAllowedPath('outputs')).not.toThrow();
  });

  it('allows path starting with prefix + /', () => {
    process.env.EXECUTION_ALLOWED_PATHS = 'outputs';
    expect(() => enforceAllowedPath('outputs/a.txt')).not.toThrow();
    expect(() => enforceAllowedPath('outputs/sub/b.txt')).not.toThrow();
  });

  it('rejects path that does not match any prefix', () => {
    process.env.EXECUTION_ALLOWED_PATHS = 'outputs';
    expect(() => enforceAllowedPath('other/b.txt')).toThrow(/outside EXECUTION_ALLOWED_PATHS/);
  });

  it('rejects partial prefix match (e.g. "outputsExtra")', () => {
    process.env.EXECUTION_ALLOWED_PATHS = 'outputs';
    expect(() => enforceAllowedPath('outputsExtra/file.txt')).toThrow(/outside EXECUTION_ALLOWED_PATHS/);
  });

  it('allows paths under multiple prefixes', () => {
    process.env.EXECUTION_ALLOWED_PATHS = 'outputs,reports';
    expect(() => enforceAllowedPath('outputs/a.txt')).not.toThrow();
    expect(() => enforceAllowedPath('reports/b.txt')).not.toThrow();
    expect(() => enforceAllowedPath('other/c.txt')).toThrow();
  });

  it('normalises backslashes in the candidate path', () => {
    process.env.EXECUTION_ALLOWED_PATHS = 'outputs';
    expect(() => enforceAllowedPath('outputs\\a.txt')).not.toThrow();
  });

  it('normalises leading ./ in the candidate path', () => {
    process.env.EXECUTION_ALLOWED_PATHS = 'outputs';
    expect(() => enforceAllowedPath('./outputs/a.txt')).not.toThrow();
  });

  it('allows "." (root) only when "." is in the allowlist', () => {
    process.env.EXECUTION_ALLOWED_PATHS = 'outputs';
    expect(() => enforceAllowedPath('.')).toThrow(/outside EXECUTION_ALLOWED_PATHS/);

    process.env.EXECUTION_ALLOWED_PATHS = '.';
    expect(() => enforceAllowedPath('.')).not.toThrow();
  });

  it('prefix "." allows all paths', () => {
    process.env.EXECUTION_ALLOWED_PATHS = '.';
    expect(() => enforceAllowedPath('anything/deep.txt')).not.toThrow();
    expect(() => enforceAllowedPath('other')).not.toThrow();
  });

  it('error message includes the path and allowed list', () => {
    process.env.EXECUTION_ALLOWED_PATHS = 'outputs,reports';
    expect(() => enforceAllowedPath('bad/path.txt')).toThrow(
      /Path "bad\/path\.txt" is outside EXECUTION_ALLOWED_PATHS \(allowed: outputs, reports\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// getNetworkPolicy
// ---------------------------------------------------------------------------

describe('getNetworkPolicy', () => {
  afterEach(() => {
    delete process.env.EXECUTION_NETWORK_POLICY;
  });

  it('returns "allow" when unset', () => {
    delete process.env.EXECUTION_NETWORK_POLICY;
    expect(getNetworkPolicy()).toBe('allow');
  });

  it('returns "allow" for EXECUTION_NETWORK_POLICY=allow', () => {
    process.env.EXECUTION_NETWORK_POLICY = 'allow';
    expect(getNetworkPolicy()).toBe('allow');
  });

  it('returns "deny" for EXECUTION_NETWORK_POLICY=deny', () => {
    process.env.EXECUTION_NETWORK_POLICY = 'deny';
    expect(getNetworkPolicy()).toBe('deny');
  });

  it('returns "allow" and warns for unknown values', () => {
    process.env.EXECUTION_NETWORK_POLICY = 'block';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getNetworkPolicy()).toBe('allow');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('block'));
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// enforceNetworkPolicy
// ---------------------------------------------------------------------------

describe('enforceNetworkPolicy', () => {
  afterEach(() => {
    delete process.env.EXECUTION_NETWORK_POLICY;
  });

  it('does nothing when policy is allow', () => {
    process.env.EXECUTION_NETWORK_POLICY = 'allow';
    expect(() => enforceNetworkPolicy('curl')).not.toThrow();
    expect(() => enforceNetworkPolicy('wget')).not.toThrow();
    expect(() => enforceNetworkPolicy('ls')).not.toThrow();
  });

  it('throws for blocked commands when policy is deny', () => {
    process.env.EXECUTION_NETWORK_POLICY = 'deny';
    const blocked = [
      'curl', 'wget', 'nc', 'ncat', 'netcat', 'ssh', 'scp', 'sftp', 'ftp',
      'telnet', 'ping', 'ping6', 'nslookup', 'dig', 'host', 'rsync', 'traceroute',
    ];
    for (const cmd of blocked) {
      expect(() => enforceNetworkPolicy(cmd)).toThrow(/blocked by EXECUTION_NETWORK_POLICY=deny/);
    }
  });

  it('allows non-network commands when policy is deny', () => {
    process.env.EXECUTION_NETWORK_POLICY = 'deny';
    for (const cmd of ['ls', 'echo', 'cat', 'grep', 'node', 'python3']) {
      expect(() => enforceNetworkPolicy(cmd)).not.toThrow();
    }
  });

  it('blocks full-path network commands by basename', () => {
    process.env.EXECUTION_NETWORK_POLICY = 'deny';
    expect(() => enforceNetworkPolicy('/usr/bin/curl')).toThrow(/blocked/);
    expect(() => enforceNetworkPolicy('/usr/bin/wget')).toThrow(/blocked/);
    expect(() => enforceNetworkPolicy('/usr/sbin/ping')).toThrow(/blocked/);
  });

  it('comparison is case-insensitive', () => {
    process.env.EXECUTION_NETWORK_POLICY = 'deny';
    expect(() => enforceNetworkPolicy('CURL')).toThrow(/blocked/);
    expect(() => enforceNetworkPolicy('Wget')).toThrow(/blocked/);
  });
});

// ---------------------------------------------------------------------------
// LocalBackend integration: EXECUTION_ALLOWED_PATHS
// ---------------------------------------------------------------------------

describe('LocalBackend — EXECUTION_ALLOWED_PATHS integration', () => {
  let tmpDir: string;
  let backend: LocalBackend;

  beforeEach(() => {
    _spawnMockImpl = null; // use real spawn
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-policy-'));
    process.env.SKILL_FILE_SANDBOX_DIR = tmpDir;
    process.env.EXECUTION_ALLOWED_PATHS = 'outputs';
    backend = new LocalBackend();
  });

  afterEach(() => {
    delete process.env.SKILL_FILE_SANDBOX_DIR;
    delete process.env.EXECUTION_ALLOWED_PATHS;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // writeFile
  it('writeFile succeeds for a path under the allowed prefix', async () => {
    const result = await backend.writeFile({ relativePath: 'outputs/a.txt', content: 'ok' });
    expect(result.backend).toBe('local');
    expect(fs.existsSync(result.path)).toBe(true);
  });

  it('writeFile throws for a path outside the allowed prefix', async () => {
    await expect(backend.writeFile({ relativePath: 'other/b.txt', content: 'bad' }))
      .rejects.toThrow(/outside EXECUTION_ALLOWED_PATHS/);
  });

  it('writeFile throws for a path that partially matches the prefix', async () => {
    await expect(backend.writeFile({ relativePath: 'outputsExtra/c.txt', content: 'bad' }))
      .rejects.toThrow(/outside EXECUTION_ALLOWED_PATHS/);
  });

  // readFile
  it('readFile succeeds for a path under the allowed prefix', async () => {
    fs.mkdirSync(path.join(tmpDir, 'outputs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'outputs', 'r.txt'), 'content', 'utf8');
    const result = await backend.readFile({ relativePath: 'outputs/r.txt' });
    expect(result.content).toBe('content');
  });

  it('readFile throws for a path outside the allowed prefix', async () => {
    await expect(backend.readFile({ relativePath: 'secret/r.txt' }))
      .rejects.toThrow(/outside EXECUTION_ALLOWED_PATHS/);
  });

  // listDir
  it('listDir succeeds for a path under the allowed prefix', async () => {
    fs.mkdirSync(path.join(tmpDir, 'outputs'), { recursive: true });
    const result = await backend.listDir({ relativePath: 'outputs' });
    expect(result.backend).toBe('local');
  });

  it('listDir throws for a path outside the allowed prefix', async () => {
    await expect(backend.listDir({ relativePath: 'other' }))
      .rejects.toThrow(/outside EXECUTION_ALLOWED_PATHS/);
  });

  it('listDir throws for "." (root) when only "outputs" is allowed', async () => {
    await expect(backend.listDir({ relativePath: '.' }))
      .rejects.toThrow(/outside EXECUTION_ALLOWED_PATHS/);
  });

  // describe() reflects the policy
  it('describe() includes allowedPaths and networkPolicy', () => {
    const desc = backend.describe();
    expect(desc.allowedPaths).toEqual(['outputs']);
    expect(desc.networkPolicy).toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// LocalBackend integration: EXECUTION_NETWORK_POLICY
// ---------------------------------------------------------------------------

describe('LocalBackend — EXECUTION_NETWORK_POLICY integration', () => {
  let tmpDir: string;
  let backend: LocalBackend;

  beforeEach(() => {
    _spawnMockImpl = null; // use real spawn
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-net-'));
    process.env.SKILL_FILE_SANDBOX_DIR = tmpDir;
    process.env.EXECUTION_NETWORK_POLICY = 'deny';
    backend = new LocalBackend();
  });

  afterEach(() => {
    delete process.env.SKILL_FILE_SANDBOX_DIR;
    delete process.env.EXECUTION_NETWORK_POLICY;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runCommand throws synchronously for a blocked network command', async () => {
    await expect(backend.runCommand({ command: 'curl', args: ['https://example.com'] }))
      .rejects.toThrow(/blocked by EXECUTION_NETWORK_POLICY=deny/);
  });

  it('runCommand throws for a full-path network command', async () => {
    await expect(backend.runCommand({ command: '/usr/bin/curl', args: [] }))
      .rejects.toThrow(/blocked/);
  });

  it('runCommand succeeds for a non-network command', async () => {
    if (process.platform === 'win32') return; // skip on Windows
    const result = await backend.runCommand({ command: 'echo', args: ['hello'] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
  });

  it('describe() reflects networkPolicy=deny', () => {
    const desc = backend.describe();
    expect(desc.networkPolicy).toBe('deny');
  });
});

// ---------------------------------------------------------------------------
// LocalBackend integration: no policy (backwards-compatible)
// ---------------------------------------------------------------------------

describe('LocalBackend — no policy set (backwards-compatible)', () => {
  let tmpDir: string;
  let backend: LocalBackend;

  beforeEach(() => {
    _spawnMockImpl = null;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-nopolicy-'));
    process.env.SKILL_FILE_SANDBOX_DIR = tmpDir;
    delete process.env.EXECUTION_ALLOWED_PATHS;
    delete process.env.EXECUTION_NETWORK_POLICY;
    backend = new LocalBackend();
  });

  afterEach(() => {
    delete process.env.SKILL_FILE_SANDBOX_DIR;
    delete process.env.EXECUTION_ALLOWED_PATHS;
    delete process.env.EXECUTION_NETWORK_POLICY;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writeFile to any sub-path succeeds', async () => {
    const result = await backend.writeFile({ relativePath: 'any/sub/path.txt', content: 'ok' });
    expect(result.backend).toBe('local');
  });

  it('listDir at root "." succeeds', async () => {
    const result = await backend.listDir({ relativePath: '.' });
    expect(result.backend).toBe('local');
  });

  it('runCommand with curl succeeds (not blocked)', async () => {
    // Just verify it doesn't throw the policy error; actual execution may fail
    // because curl may not be installed, but the error won't be about the policy.
    try {
      await backend.runCommand({ command: 'curl', args: ['--version'] });
    } catch (err) {
      // If curl is not installed, that's fine — just ensure it's not a policy error
      expect(String(err)).not.toMatch(/blocked by EXECUTION_NETWORK_POLICY/);
    }
  });

  it('describe() has undefined allowedPaths and networkPolicy=allow', () => {
    const desc = backend.describe();
    expect(desc.allowedPaths).toBeUndefined();
    expect(desc.networkPolicy).toBe('allow');
  });
});
