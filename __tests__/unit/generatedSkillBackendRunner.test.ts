/**
 * Unit tests for lib/skillProposals/backendRunner.ts
 *
 * Uses the real LocalBackend (EXECUTION_BACKEND unset = local) with a
 * temporary SKILL_FILE_SANDBOX_DIR so generated scripts are isolated to a
 * test-owned directory.  Real node child-processes are spawned, so timeoutMs
 * values are generous (10 000 ms for normal cases, 200 ms only for the
 * timeout case).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runProposalCodeOnBackend } from '../../lib/skillProposals/backendRunner';
import { getGeneratedSkillRunner } from '../../lib/skillProposals/lifecycle';
import { _resetExecutionBackendForTests } from '../../lib/execution';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-backend-runner-'));
  process.env.SKILL_FILE_SANDBOX_DIR = tmpDir;
  delete process.env.EXECUTION_BACKEND;
  delete process.env.GENERATED_SKILL_EXECUTION;
  _resetExecutionBackendForTests();
});

afterEach(() => {
  delete process.env.SKILL_FILE_SANDBOX_DIR;
  delete process.env.EXECUTION_BACKEND;
  delete process.env.GENERATED_SKILL_EXECUTION;
  _resetExecutionBackendForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// runProposalCodeOnBackend — core cases
// ---------------------------------------------------------------------------

describe('runProposalCodeOnBackend', () => {
  it('(1) executes a handler returning an object and returns correct content', async () => {
    const code = `module.exports = async (args) => ({ content: 'hello ' + args.name });`;
    const result = await runProposalCodeOnBackend(code, { name: 'world' }, { timeoutMs: 10_000 });
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('hello world');
  }, 15_000);

  it('(2) normalises a plain string return into { content }', async () => {
    const code = `module.exports = async () => 'just a string';`;
    const result = await runProposalCodeOnBackend(code, {}, { timeoutMs: 10_000 });
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('just a string');
  }, 15_000);

  it('(3) catches a handler that throws and returns isError', async () => {
    const code = `module.exports = async () => { throw new Error('handler boom'); };`;
    const result = await runProposalCodeOnBackend(code, {}, { timeoutMs: 10_000 });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('handler boom');
  }, 15_000);

  it('(4) returns isError when module.exports is not defined', async () => {
    const code = `const x = 42; // no module.exports`;
    const result = await runProposalCodeOnBackend(code, {}, { timeoutMs: 10_000 });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('did not export a handler');
  }, 15_000);

  it('(5) times out a handler that never settles', async () => {
    const code = `module.exports = () => new Promise(() => {});`;
    const result = await runProposalCodeOnBackend(code, {}, { timeoutMs: 200 });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/timed out/i);
  }, 10_000);

  it('(6) writes the script under generated_skills/ inside the sandbox dir', async () => {
    const code = `module.exports = async () => ({ content: 'check path' });`;
    await runProposalCodeOnBackend(code, {}, { timeoutMs: 10_000 });

    const genDir = path.join(tmpDir, 'generated_skills');
    expect(fs.existsSync(genDir)).toBe(true);
    const files = fs.readdirSync(genDir);
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]).toMatch(/^[0-9a-f]{16}\.js$/);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// getGeneratedSkillRunner — mode switching
// ---------------------------------------------------------------------------

describe('getGeneratedSkillRunner', () => {
  it('returns runProposalCode (vm) when GENERATED_SKILL_EXECUTION is unset', () => {
    delete process.env.GENERATED_SKILL_EXECUTION;
    const runner = getGeneratedSkillRunner();
    // The vm runner is the same reference as the named export from sandbox.ts
    const { runProposalCode } = require('../../lib/skillProposals/sandbox');
    expect(runner).toBe(runProposalCode);
  });

  it('returns runProposalCode (vm) when GENERATED_SKILL_EXECUTION=vm', () => {
    process.env.GENERATED_SKILL_EXECUTION = 'vm';
    const runner = getGeneratedSkillRunner();
    const { runProposalCode } = require('../../lib/skillProposals/sandbox');
    expect(runner).toBe(runProposalCode);
  });

  it('returns runProposalCodeOnBackend when GENERATED_SKILL_EXECUTION=backend', () => {
    process.env.GENERATED_SKILL_EXECUTION = 'backend';
    const runner = getGeneratedSkillRunner();
    expect(runner).toBe(runProposalCodeOnBackend);
  });

  it('falls back to vm and warns on an unknown GENERATED_SKILL_EXECUTION value', () => {
    process.env.GENERATED_SKILL_EXECUTION = 'unknown_mode';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runner = getGeneratedSkillRunner();
    const { runProposalCode } = require('../../lib/skillProposals/sandbox');
    expect(runner).toBe(runProposalCode);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown_mode'));
    warnSpy.mockRestore();
  });

  it('backend runner produces correct output via the backend execution path', async () => {
    process.env.GENERATED_SKILL_EXECUTION = 'backend';
    const runner = getGeneratedSkillRunner();
    const code = `module.exports = async (args) => ({ content: 'backend:' + args.x });`;
    const result = await runner(code, { x: 'ok' }, { timeoutMs: 10_000 });
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('backend:ok');
  }, 15_000);
});
