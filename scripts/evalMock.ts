import { strict as assert } from 'assert';
import { runAgentLoop, type AgentStopReason } from '../lib/agents/agentLoop';
import type { LLMRequest } from '../lib/adapter';

async function main() {
  const scenarios: Array<{ name: string; expected: AgentStopReason; complete: (r: LLMRequest) => Promise<{ content: string }> }> = [
    { name: 'first-round success', expected: 'succeeded', complete: async r => { await r.skills!.find(s => s.name === 'markComplete')!.handler({ summary: 'done' }); return { content: 'done' }; } },
    { name: 'impossible goal', expected: 'failed', complete: async r => { await r.skills!.find(s => s.name === 'markFailed')!.handler({ summary: 'impossible' }); return { content: '' }; } },
    { name: 'provider exception', expected: 'failed', complete: async () => { throw new Error('offline'); } },
    { name: 'empty responses', expected: 'stalled', complete: async () => ({ content: '' }) },
    { name: 'iteration budget', expected: 'iteration_limit', complete: async () => ({ content: 'still working' }) },
    { name: 'additional information', expected: 'waiting_input', complete: async r => { await r.skills!.find(s => s.name === 'requestUserInput')!.handler({ question: 'Which file?' }); return { content: '' }; } },
  ];
  for (const scenario of scenarios) {
    const result = await runAgentLoop({ goal: 'mock evaluation', maxIterations: 3, adapter: { provider: 'mock', model: 'mock', complete: scenario.complete } });
    assert.equal(result.stopReason, scenario.expected, scenario.name);
    assert.equal(result.completed, scenario.expected === 'succeeded', scenario.name);
    assert.ok(result.iterations >= 1 && result.iterations <= 3);
    console.log('PASS ' + scenario.name);
  }
  const abort = new AbortController(); abort.abort();
  const result = await runAgentLoop({ goal: 'cancelled', abortSignal: abort.signal, adapter: { provider: 'mock', model: 'mock', complete: async () => { throw new Error('must not execute'); } } });
  assert.equal(result.stopReason, 'cancelled'); assert.equal(result.iterations, 0);
  console.log('PASS cancellation');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
