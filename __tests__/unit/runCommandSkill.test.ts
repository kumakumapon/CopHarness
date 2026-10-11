import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCommand } from '../../lib/skills/runCommand';
import { LocalBackend } from '../../lib/execution/localBackend';

const isWin = process.platform === 'win32';

describe('runCommand skill policy integration', () => {
  it('rejects a disallowed flag with a policy message', async () => {
    const result = await runCommand.handler(
      isWin ? { command: 'cat', args: ['x'] } : { command: 'find', args: ['.', '-delete'] },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/not allowed/);
  });

  it('rejects sandbox-escaping paths before reaching the backend', async () => {
    const result = await runCommand.handler(
      isWin
        ? { command: 'type', args: ['C:\\Windows\\win.ini'] }
        : { command: 'cat', args: ['/etc/hostname'] },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/outside the sandbox/);
  });

  it('dryRun applies the same policy', async () => {
    await expect(
      runCommand.dryRun!(
        isWin ? { command: 'type', args: ['..\\x'] } : { command: 'sort', args: ['-o', 'out', 'in'] },
      ),
    ).rejects.toThrow();
  });
});

describe('LocalBackend runs commands inside the sandbox directory', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-cwd-')));
    process.env.SKILL_FILE_SANDBOX_DIR = dir;
  });
  afterEach(() => {
    delete process.env.SKILL_FILE_SANDBOX_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('uses the sandbox as cwd rather than the application directory', async () => {
    const result = await new LocalBackend().runCommand({
      command: isWin ? 'cd' : 'pwd',
      args: [],
    });
    expect(path.resolve(result.stdout.trim()).toLowerCase()).toBe(dir.toLowerCase());
  });
});
