import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import { getSkillExecutionContext, withSkillExecutionContext } from '../../lib/skills/executionContext';
import { _resetTaskLedgerForTests, listTasks } from '../../lib/tasks/ledger';

jest.mock('../../lib/adapterFactory', () => ({
  createAdapter: jest.fn(),
  resolveProvider: jest.fn(),
  resolveModel: jest.fn(),
}));

import * as adapterFactory from '../../lib/adapterFactory';
import type { LLMAdapter, LLMRequest } from '../../lib/adapter';
import { runAgentTask } from '../../lib/agents/orchestrator';
import { runPrompt } from '../../lib/scheduler/engine';

const mockComplete = jest.fn();
const mockDestroy = jest.fn();

function installMockAdapter() {
  mockComplete.mockReset();
  mockDestroy.mockReset();
  (adapterFactory.resolveProvider as jest.Mock).mockReturnValue('openai');
  (adapterFactory.resolveModel as jest.Mock).mockReturnValue('gpt-test');
  (adapterFactory.createAdapter as jest.Mock).mockReturnValue({
    provider: 'openai',
    model: 'gpt-test',
    complete: mockComplete,
    destroy: mockDestroy,
  } as unknown as LLMAdapter);
}

describe('TaskLedger integrations', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-task-ledger-integration-'));
    process.env.DATA_DIR = tmpDir;
    process.env.OPENAI_API_KEY = 'test-key';
    _resetDataDirCache();
    _resetTaskLedgerForTests();
    installMockAdapter();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.OPENAI_API_KEY;
    _resetDataDirCache();
    _resetTaskLedgerForTests();
    jest.clearAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records sub-agent tasks and inherits parent skill execution context', async () => {
    mockComplete.mockImplementation(async () => ({
      content: `agent task ${getSkillExecutionContext()?.taskId}`,
      model: 'gpt-test',
      provider: 'openai',
    }));

    const result = await withSkillExecutionContext(
      { personId: 'person_parent', channelKey: 'api:alice', taskId: 'task_parent' },
      () => runAgentTask({ role: 'summarizer', userPrompt: 'summarize this' }),
    );

    expect(result.taskId).toMatch(/^task_/);
    expect(result.content).toContain(result.taskId);
    expect(listTasks(10)[0]).toMatchObject({
      id: result.taskId,
      kind: 'agent',
      status: 'succeeded',
      personId: 'person_parent',
      channelKey: 'api:alice',
    });
    expect(listTasks(10)[0].metadata).toMatchObject({
      role: 'summarizer',
      parentTaskId: 'task_parent',
    });
  });

  it('records scheduled prompt tasks and exposes task context to adapter calls', async () => {
    let seenTaskId: string | undefined;
    let seenChannelKey: string | undefined;
    mockComplete.mockImplementation(async (_req: LLMRequest) => {
      const context = getSkillExecutionContext();
      seenTaskId = context?.taskId;
      seenChannelKey = context?.channelKey;
      return { content: 'scheduled done', model: 'gpt-test', provider: 'openai' };
    });

    const result = await runPrompt('daily report', undefined, {
      schedule: {
        id: 'schedule_1',
        name: 'Daily report',
        lineUserId: 'line-user-1',
      },
      reason: 'cron',
    });

    expect(result).toBe('scheduled done');
    expect(seenTaskId).toMatch(/^task_/);
    expect(seenChannelKey).toBe('line:line-user-1');
    expect(listTasks(10)[0]).toMatchObject({
      id: seenTaskId,
      kind: 'schedule',
      status: 'succeeded',
      channelKey: 'line:line-user-1',
      title: 'Daily report',
    });
    expect(listTasks(10)[0].metadata).toMatchObject({
      scheduleId: 'schedule_1',
      scheduleName: 'Daily report',
      reason: 'cron',
    });
  });
});
