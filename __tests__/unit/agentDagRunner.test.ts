import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runAgentDag } from '../../lib/agents/dagRunner';
import type { AgentPlanRunner } from '../../lib/agents/dagRunner';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import { _resetTaskLedgerForTests, getTask, listTasks } from '../../lib/tasks/ledger';

describe('agent DAG runner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-agent-dag-'));
    process.env.DATA_DIR = tmpDir;
    _resetDataDirCache();
    _resetTaskLedgerForTests();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    _resetDataDirCache();
    _resetTaskLedgerForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs independent nodes in the same wave and passes dependency output to dependents', async () => {
    const calls: Array<{ id: string; prompt: string; workspace?: string }> = [];
    const runner: AgentPlanRunner = jest.fn(async (task, plan) => {
      calls.push({ id: plan.id, prompt: task.userPrompt, workspace: task.workspace });
      return {
        taskId: task.id,
        role: typeof task.role === 'string' ? task.role : task.role.name,
        content: `output:${plan.id}`,
        durationMs: 1,
      };
    });

    const result = await runAgentDag([
      { id: 'research', role: 'researcher', prompt: 'Research it' },
      { id: 'review', role: 'reviewer', prompt: 'Review it' },
      { id: 'summary', role: 'summarizer', prompt: 'Summarize it', dependsOn: ['research', 'review'] },
    ], { runId: 'run_test', runner });

    expect(result.status).toBe('succeeded');
    expect(result.progress.map((entry) => entry.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect(calls.map((call) => call.id)).toEqual(['research', 'review', 'summary']);
    expect(calls[2].prompt).toContain('Dependency research (succeeded)');
    expect(calls[2].prompt).toContain('output:research');
    expect(calls[2].prompt).toContain('Dependency review (succeeded)');
    expect(calls[0].workspace).toContain(path.join('agent_workspaces', 'run_test', 'research'));
    expect(fs.existsSync(calls[0].workspace!)).toBe(true);
    expect(listTasks(10)[0]).toMatchObject({
      id: result.taskId,
      kind: 'agent',
      status: 'succeeded',
    });
    expect(getTask(result.taskId!)?.metadata?.agentDag).toMatchObject({
      runId: 'run_test',
      status: 'succeeded',
      plans: [
        expect.objectContaining({ id: 'research', role: 'researcher', dependsOn: [] }),
        expect.objectContaining({ id: 'review', role: 'reviewer', dependsOn: [] }),
        expect.objectContaining({ id: 'summary', role: 'summarizer', dependsOn: ['research', 'review'] }),
      ],
      progress: [
        expect.objectContaining({ planId: 'research', status: 'succeeded' }),
        expect.objectContaining({ planId: 'review', status: 'succeeded' }),
        expect.objectContaining({ planId: 'summary', status: 'succeeded' }),
      ],
    });
  });

  it('skips nodes whose dependency failed', async () => {
    const runner: AgentPlanRunner = jest.fn(async (task, plan) => ({
      taskId: task.id,
      role: String(plan.role),
      content: plan.id === 'build' ? '' : `output:${plan.id}`,
      durationMs: 1,
      error: plan.id === 'build' ? 'build failed' : undefined,
    }));

    const result = await runAgentDag([
      { id: 'build', role: 'coder', prompt: 'Build it' },
      { id: 'test', role: 'reviewer', prompt: 'Test it', dependsOn: ['build'] },
    ], { runId: 'run_failed', runner });

    expect(result.status).toBe('failed');
    expect(result.progress).toEqual([
      expect.objectContaining({ planId: 'build', status: 'failed', error: 'build failed' }),
      expect.objectContaining({ planId: 'test', status: 'skipped' }),
    ]);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(listTasks(10)[0]).toMatchObject({
      id: result.taskId,
      status: 'failed',
    });
  });

  it('rejects invalid DAG definitions before running agents', async () => {
    const runner = jest.fn();

    await expect(runAgentDag([
      { id: 'a', role: 'planner', prompt: 'A', dependsOn: ['missing'] },
    ], { runner })).rejects.toThrow(/unknown node/);
    await expect(runAgentDag([
      { id: 'a', role: 'planner', prompt: 'A', dependsOn: ['b'] },
      { id: 'b', role: 'planner', prompt: 'B', dependsOn: ['a'] },
    ], { runner })).rejects.toThrow(/cycle/);
    expect(runner).not.toHaveBeenCalled();
  });
});
