/**
 * Tests for TaskLedger × Ralph Loop integration (Phase 2).
 *
 * Covers:
 * - compaction updates task metadata.ralphLoop
 * - taskId resolved from skill execution context when not passed explicitly
 * - progress.md and progress.json written under WORKSPACE_DIR when writeArtifact enabled
 * - no taskId → no ledger write, no crash
 * - below threshold → adapter called once, no metadata, request fields passed through
 * - updateTaskMetadata unit cases: merge semantics, unknown id → undefined
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import {
  _resetTaskLedgerForTests,
  startTask,
  getTask,
  updateTaskMetadata,
} from '../../lib/tasks/ledger';
import { runWithRalphLoop } from '../../lib/context/ralphLoop';
import { withSkillExecutionContext } from '../../lib/skills/executionContext';
import type { LLMAdapter, LLMRequest, LLMResponse } from '../../lib/adapter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Mock adapter that returns a canned summary for compaction calls and a normal reply otherwise. */
function makeTestAdapter(opts: {
  summaryContent?: string;
  normalContent?: string;
  spy?: jest.Mock;
}): LLMAdapter {
  const { summaryContent = 'Compacted summary text', normalContent = 'Normal reply', spy } = opts;
  let callCount = 0;
  return {
    provider: 'mock',
    model: 'mock',
    async complete(req: LLMRequest): Promise<LLMResponse> {
      callCount++;
      spy?.call(undefined, req);
      // Heuristic: the compaction prompt has a system message asking for a summary
      const isCompactionCall = req.messages.some(
        (m) => m.role === 'system' && m.content.includes('summarisation assistant'),
      );
      return { content: isCompactionCall ? summaryContent : normalContent };
    },
  };
}

/** Build a long fake history that will exceed COMPACTOR_TOKEN_THRESHOLD=50. */
function longHistory(pairs = 6) {
  const msgs: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (let i = 0; i < pairs; i++) {
    msgs.push({ role: 'user', content: `User message number ${i} with some padding text to bulk up tokens` });
    msgs.push({ role: 'assistant', content: `Assistant reply number ${i} with some padding text to bulk up tokens` });
  }
  return msgs;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpData: string;
let tmpWorkspace: string;

beforeEach(() => {
  tmpData = makeTmpDir('copharness-rl-ledger-data-');
  tmpWorkspace = makeTmpDir('copharness-rl-ledger-ws-');
  process.env.DATA_DIR = tmpData;
  process.env.WORKSPACE_DIR = tmpWorkspace;
  process.env.COMPACTOR_TOKEN_THRESHOLD = '50'; // force compaction with long history
  _resetDataDirCache();
  _resetTaskLedgerForTests();
});

afterEach(() => {
  delete process.env.DATA_DIR;
  delete process.env.WORKSPACE_DIR;
  delete process.env.COMPACTOR_TOKEN_THRESHOLD;
  _resetDataDirCache();
  _resetTaskLedgerForTests();
  fs.rmSync(tmpData, { recursive: true, force: true });
  fs.rmSync(tmpWorkspace, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// updateTaskMetadata unit cases
// ---------------------------------------------------------------------------

describe('updateTaskMetadata', () => {
  it('returns undefined for an unknown task id', async () => {
    const result = await updateTaskMetadata('nonexistent-task', { foo: 'bar' });
    expect(result).toBeUndefined();
  });

  it('shallow-merges patch into existing metadata', async () => {
    const task = await startTask({ kind: 'conversation', metadata: { existing: true } });
    const updated = await updateTaskMetadata(task.id, { newKey: 'newValue' });
    expect(updated).toBeDefined();
    expect(updated!.metadata).toEqual({ existing: true, newKey: 'newValue' });
  });

  it('creates metadata from scratch when absent', async () => {
    const task = await startTask({ kind: 'api' });
    expect(task.metadata).toBeUndefined();
    const updated = await updateTaskMetadata(task.id, { created: 1 });
    expect(updated!.metadata).toEqual({ created: 1 });
  });

  it('overwrites existing keys on shallow merge', async () => {
    const task = await startTask({ kind: 'api', metadata: { key: 'old' } });
    const updated = await updateTaskMetadata(task.id, { key: 'new' });
    expect(updated!.metadata!.key).toBe('new');
  });

  it('bumps updatedAt', async () => {
    const task = await startTask({ kind: 'api' });
    const before = task.updatedAt;
    // Small delay to ensure timestamp advances
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateTaskMetadata(task.id, { x: 1 });
    expect(updated!.updatedAt >= before).toBe(true);
  });

  it('returns a defensive copy (mutating return value does not affect stored record)', async () => {
    const task = await startTask({ kind: 'api', metadata: { a: 1 } });
    const updated = await updateTaskMetadata(task.id, { b: 2 });
    updated!.metadata!.b = 999;
    const fresh = getTask(task.id);
    expect(fresh!.metadata!.b).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Compaction updates task metadata.ralphLoop
// ---------------------------------------------------------------------------

describe('runWithRalphLoop + ledger metadata', () => {
  it('updates task metadata.ralphLoop after compaction', async () => {
    const task = await startTask({ kind: 'conversation', title: 'test goal' });
    const adapter = makeTestAdapter({});

    await runWithRalphLoop(
      { messages: longHistory(), timeoutMs: 5_000 },
      adapter,
      { taskId: task.id, originalGoal: 'Complete the test task' },
    );

    const updated = getTask(task.id);
    expect(updated).toBeDefined();
    expect(updated!.metadata?.ralphLoop).toBeDefined();
    const rl = updated!.metadata!.ralphLoop as Record<string, unknown>;
    expect(typeof rl.compactionRounds).toBe('number');
    expect((rl.compactionRounds as number)).toBeGreaterThanOrEqual(1);
    expect(typeof rl.lastCompactedAt).toBe('string');
    expect(rl.goalPreview).toBe('Complete the test task');
    expect(typeof rl.lastSummaryPreview).toBe('string');
  });

  it('lastSummaryPreview contains the summary content', async () => {
    const task = await startTask({ kind: 'conversation' });
    const adapter = makeTestAdapter({ summaryContent: 'Detailed summary of earlier messages' });

    await runWithRalphLoop(
      { messages: longHistory(), timeoutMs: 5_000 },
      adapter,
      { taskId: task.id, originalGoal: 'My goal' },
    );

    const rl = getTask(task.id)!.metadata!.ralphLoop as Record<string, unknown>;
    expect((rl.lastSummaryPreview as string)).toContain('Detailed summary');
  });

  it('resolves taskId from skill execution context when not passed explicitly', async () => {
    const task = await startTask({ kind: 'conversation' });
    const adapter = makeTestAdapter({});

    // Do NOT pass taskId in options — should be picked up from context
    await withSkillExecutionContext(
      { taskId: task.id },
      () => runWithRalphLoop(
        { messages: longHistory(), timeoutMs: 5_000 },
        adapter,
        { originalGoal: 'Context-resolved goal' },
      ),
    );

    const updated = getTask(task.id);
    expect(updated!.metadata?.ralphLoop).toBeDefined();
    const rl = updated!.metadata!.ralphLoop as Record<string, unknown>;
    expect(rl.goalPreview).toBe('Context-resolved goal');
  });

  it('no taskId → no ledger write, no crash', async () => {
    const adapter = makeTestAdapter({});

    // No task created, no taskId in context, no taskId in options
    const resp = await runWithRalphLoop(
      { messages: longHistory(), timeoutMs: 5_000 },
      adapter,
      { originalGoal: 'Some goal' },
    );

    // Should not throw and should return the normal reply
    expect(resp.content).toBe('Normal reply');
  });
});

// ---------------------------------------------------------------------------
// progress.md and progress.json written under WORKSPACE_DIR
// ---------------------------------------------------------------------------

describe('runWithRalphLoop + writeArtifact', () => {
  it('writes progress.md and progress.json when writeArtifact is enabled', async () => {
    const task = await startTask({ kind: 'conversation' });
    const adapter = makeTestAdapter({ summaryContent: 'Summary of prior messages' });

    await runWithRalphLoop(
      { messages: longHistory(), timeoutMs: 5_000 },
      adapter,
      { taskId: task.id, originalGoal: 'Write artifact goal', writeArtifact: true },
    );

    const mdPath = path.join(tmpWorkspace, 'progress.md');
    const jsonPath = path.join(tmpWorkspace, 'progress.json');
    expect(fs.existsSync(mdPath)).toBe(true);
    expect(fs.existsSync(jsonPath)).toBe(true);

    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(json.goal).toBe('Write artifact goal');
    expect(json.taskId).toBe(task.id);
    expect(typeof json.summary).toBe('string');
    expect(typeof json.updatedAt).toBe('string');
  });

  it('progress.json omits taskId when none is known', async () => {
    const adapter = makeTestAdapter({});

    // writeArtifact requires originalGoal per existing semantics
    await runWithRalphLoop(
      { messages: longHistory(), timeoutMs: 5_000 },
      adapter,
      { originalGoal: 'No task id goal', writeArtifact: true },
    );

    const jsonPath = path.join(tmpWorkspace, 'progress.json');
    expect(fs.existsSync(jsonPath)).toBe(true);
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(json.goal).toBe('No task id goal');
    expect(Object.prototype.hasOwnProperty.call(json, 'taskId')).toBe(false);
  });

  it('does NOT write artifacts when writeArtifact is false (default)', async () => {
    const task = await startTask({ kind: 'conversation' });
    const adapter = makeTestAdapter({});

    await runWithRalphLoop(
      { messages: longHistory(), timeoutMs: 5_000 },
      adapter,
      { taskId: task.id, originalGoal: 'Hidden artifact' },
    );

    expect(fs.existsSync(path.join(tmpWorkspace, 'progress.json'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Below threshold → adapter called once, request fields passed through unchanged
// ---------------------------------------------------------------------------

describe('runWithRalphLoop below threshold', () => {
  beforeEach(() => {
    // Override to use a high threshold so no compaction occurs
    process.env.COMPACTOR_TOKEN_THRESHOLD = '100000';
  });

  it('calls adapter exactly once for short conversations', async () => {
    const calls: LLMRequest[] = [];
    const spy = jest.fn((req: LLMRequest) => calls.push(req));
    const adapter = makeTestAdapter({ normalContent: 'Short reply', spy });

    const skills = [{ name: 'testSkill', description: 'desc', parameters: { type: 'object' as const, properties: {} }, handler: async () => ({ content: '' }) }];
    const resp = await runWithRalphLoop(
      { messages: [{ role: 'user', content: 'hi' }], timeoutMs: 9_999, skills },
      adapter,
    );

    expect(resp.content).toBe('Short reply');
    // spy is called once per adapter.complete call; the first (and only) call is the main one
    const mainCalls = calls.filter((r) => r.messages.some((m) => m.role === 'user' && m.content === 'hi'));
    expect(mainCalls.length).toBe(1);
    expect(mainCalls[0].timeoutMs).toBe(9_999);
    expect(mainCalls[0].skills).toBe(skills);
  });

  it('passes attachments through to the adapter', async () => {
    const calls: LLMRequest[] = [];
    const spy = jest.fn((req: LLMRequest) => calls.push(req));
    const adapter = makeTestAdapter({ spy });

    const attachments = [{ type: 'blob' as const, data: 'abc', mimeType: 'image/png' }];
    await runWithRalphLoop(
      { messages: [{ role: 'user', content: 'look at this' }], attachments },
      adapter,
    );

    const mainCall = calls.find((r) => r.messages.some((m) => m.content === 'look at this'));
    expect(mainCall).toBeDefined();
    expect(mainCall!.attachments).toBe(attachments);
  });

  it('does not write metadata when below threshold (no compaction)', async () => {
    const task = await startTask({ kind: 'conversation' });
    const adapter = makeTestAdapter({});

    await runWithRalphLoop(
      { messages: [{ role: 'user', content: 'short' }], timeoutMs: 5_000 },
      adapter,
      { taskId: task.id },
    );

    const fresh = getTask(task.id);
    // No compaction → no ralphLoop metadata written
    expect(fresh!.metadata?.ralphLoop).toBeUndefined();
  });
});
