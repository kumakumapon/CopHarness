import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

describe('Gemini stream', () => {
  it('separates thoughts, keeps signatures in native parts and maps function calls', () => {
    const worker = path.join(__dirname, 'fixtures', 'geminiWorker.ts');
    const out = execFileSync(process.execPath, ['--import', 'tsx', worker], { encoding: 'utf8', timeout: 60_000 });
    const { events, result: r, requests } = JSON.parse(out);
    expect(events).toEqual([{ type: 'reasoning_delta', text: 'thinking...' }, { type: 'text_delta', text: 'Let me check.' }]);
    expect(r.stopReason).toBe('tool_use');
    expect(r.message.content).toEqual([
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_call', id: 'gemini_auto_0', name: 'read_file', input: { path: 'b' } },
    ]);
    expect(r.message.native.content[2]).toMatchObject({ thoughtSignature: 'TS' });
    expect(r.usage).toEqual({ inputTokens: 20, outputTokens: 10, cacheReadTokens: 10, cacheWriteTokens: 0 });
    expect(requests[0]).toContain('streamGenerateContent');
  }, 90_000);
});
