import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import { registerSkill, type SkillDefinition } from '../../lib/skill';
import {
  _resetSkillExecutionLogForTests,
  listSkillExecutionSummaries,
  listSkillExecutions,
} from '../../lib/skills/executionLog';

describe('skill execution logging', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-skill-log-'));
    process.env.DATA_DIR = tmpDir;
    _resetDataDirCache();
    _resetSkillExecutionLogForTests();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    _resetDataDirCache();
    _resetSkillExecutionLogForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records successful and error SkillResult executions', async () => {
    const skill: SkillDefinition = {
      name: '__logged_skill__',
      description: 'records metrics',
      parameters: { type: 'object', properties: {} },
      handler: async (args) => ({
        content: args.fail ? 'controlled failure' : 'ok',
        isError: Boolean(args.fail),
      }),
    };
    registerSkill(skill);

    await skill.handler({ value: 1 });
    await skill.handler({ fail: true });

    const records = listSkillExecutions(10);
    expect(records).toHaveLength(2);
    expect(records[0].status).toBe('error');
    expect(records[1].status).toBe('success');

    const summary = listSkillExecutionSummaries().find((s) => s.skillName === '__logged_skill__');
    expect(summary).toMatchObject({
      totalRuns: 2,
      successRuns: 1,
      errorRuns: 1,
      exceptionRuns: 0,
      successRate: 0.5,
      lastStatus: 'error',
    });
  });

  it('records thrown exceptions and rethrows them', async () => {
    const skill: SkillDefinition = {
      name: '__exception_skill__',
      description: 'throws',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        throw new Error('boom');
      },
    };
    registerSkill(skill);

    await expect(skill.handler({})).rejects.toThrow('boom');

    const summary = listSkillExecutionSummaries().find((s) => s.skillName === '__exception_skill__');
    expect(summary).toMatchObject({
      totalRuns: 1,
      successRuns: 0,
      errorRuns: 0,
      exceptionRuns: 1,
      successRate: 0,
      lastStatus: 'exception',
      lastErrorPreview: 'boom',
    });
  });
});
