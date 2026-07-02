import { buildDryRunPreview, formatDryRunPreview } from '../../lib/toolPolicy/dryRun';
import { writeFile } from '../../lib/skills/writeFile';
import { runCommand } from '../../lib/skills/runCommand';
import { _resetExecutionBackendForTests } from '../../lib/execution';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('tool policy dry-run previews', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'copharness-dryrun-'));
    process.env.SKILL_FILE_SANDBOX_DIR = sandbox;
    delete process.env.EXECUTION_BACKEND;
    _resetExecutionBackendForTests();
  });

  afterEach(async () => {
    delete process.env.SKILL_FILE_SANDBOX_DIR;
    _resetExecutionBackendForTests();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it('generates a diff preview for writeFile without writing the file', async () => {
    const preview = await buildDryRunPreview(writeFile, { path: 'note.txt', content: 'hello' });

    expect(preview.available).toBe(true);
    expect(preview.summary).toContain('Create file note.txt');
    expect(preview.targets).toEqual(['note.txt']);
    expect(preview.diff).toContain('+++ b/note.txt');
    expect(preview.diff).toContain('+hello');
    await expect(fs.stat(path.join(sandbox, 'note.txt'))).rejects.toThrow();
  });

  it('generates command preview for runCommand without executing it', async () => {
    const preview = await buildDryRunPreview(runCommand, { command: 'echo', args: ['hello'] });

    expect(preview.available).toBe(true);
    expect(preview.command).toBe('echo hello');
    expect(preview.riskAttributes).toContain('process-execution');
    expect(formatDryRunPreview(preview)).toContain('Command: echo hello');
  });

  it('redacts secrets from preview text', async () => {
    const preview = await buildDryRunPreview(writeFile, { path: 'secret.txt', content: 'token=sk-1234567890abcdef' });

    expect(preview.diff).toContain('[REDACTED]');
    expect(preview.diff).not.toContain('sk-1234567890abcdef');
  });
});
