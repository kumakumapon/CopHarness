import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { diagnoseRuntime } from '../../lib/diagnostics';
import { _resetExecutionBackendForTests } from '../../lib/execution';
jest.mock('../../lib/skill', () => ({ listActiveSkills: () => [{ name: 'readFile', riskLevel: 'low' }] }));
const original = process.env;
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-')); process.env = { ...original, DATA_DIR: dir, COPILOT_PROVIDER: 'openai', OPENAI_API_KEY: 'secret-test-sentinel', EXECUTION_BACKEND: 'local' }; _resetExecutionBackendForTests(); });
afterEach(() => { process.env = original; _resetExecutionBackendForTests(); fs.rmSync(dir, { recursive: true, force: true }); });
it('reports effective settings and fixes without disclosing keys', () => {
  const report = diagnoseRuntime();
  expect(JSON.stringify(report)).not.toContain('secret-test-sentinel');
  expect(report.find(c => c.name === 'provider')?.status).toBe('ok');
  expect(report.find(c => c.name === 'skills')?.detail).toContain('readFile [low]');
  expect(report.find(c => c.name === 'connection')?.detail).toContain('Not probed');
});
it('flags backend typos instead of falling back to local', () => {
  process.env.EXECUTION_BACKEND = 'dockre';
  expect(diagnoseRuntime().find(c => c.name === 'backend')?.status).toBe('error');
});
it('diagnoses a missing selected-provider key', () => {
  delete process.env.OPENAI_API_KEY; delete process.env.COPILOT_API_KEY; delete process.env.COPILOT_PROVIDER_API_KEY;
  process.env.GEMINI_API_KEY = 'different-provider-secret';
  const report = diagnoseRuntime();
  expect(report.find(c => c.name === 'provider')?.status).toBe('error');
  expect(JSON.stringify(report)).not.toContain('different-provider-secret');
});
