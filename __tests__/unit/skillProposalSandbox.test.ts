import { runProposalCode, runProposalTests } from '../../lib/skillProposals/sandbox';

describe('skill proposal sandbox', () => {
  describe('runProposalCode', () => {
    it('runs an async handler returning a SkillResult', async () => {
      const code = `module.exports = async (args) => ({ content: 'sum=' + (args.a + args.b) });`;
      const result = await runProposalCode(code, { a: 2, b: 3 });
      expect(result).toEqual({ content: 'sum=5', isError: false });
    });

    it('normalizes a plain string return value', async () => {
      const code = `module.exports = async () => 'hello';`;
      const result = await runProposalCode(code, {});
      expect(result).toEqual({ content: 'hello' });
    });

    it('normalizes a sync handler returning a serializable object', async () => {
      const code = `module.exports = (args) => ({ content: JSON.stringify({ ok: true }) });`;
      const result = await runProposalCode(code, {});
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(result.content)).toEqual({ ok: true });
    });

    it('fails when code does not export a handler', async () => {
      const result = await runProposalCode(`const x = 1;`, {});
      expect(result.isError).toBe(true);
      expect(result.content).toContain('did not export a handler');
    });

    it('fails when the handler throws', async () => {
      const code = `module.exports = async () => { throw new Error('boom'); };`;
      const result = await runProposalCode(code, {});
      expect(result.isError).toBe(true);
      expect(result.content).toContain('boom');
    });

    it('interrupts a synchronous infinite loop via the vm timeout', async () => {
      const code = `module.exports = () => { while (true) {} };`;
      const result = await runProposalCode(code, {}, { timeoutMs: 200 });
      expect(result.isError).toBe(true);
    });

    it('times out an async handler that never settles', async () => {
      const code = `module.exports = () => new Promise(() => {});`;
      const result = await runProposalCode(code, {}, { timeoutMs: 200 });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('timed out');
    });

    it('does not expose require', async () => {
      const code = `module.exports = async () => { const fs = require('fs'); return 'no'; };`;
      const result = await runProposalCode(code, {});
      expect(result.isError).toBe(true);
      expect(result.content).toContain('require');
    });

    it('does not expose process', async () => {
      const code = `module.exports = async () => process.env.HOME;`;
      const result = await runProposalCode(code, {});
      expect(result.isError).toBe(true);
    });

    it('does not expose fetch or timers', async () => {
      const fetchResult = await runProposalCode(`module.exports = async () => fetch('http://x');`, {});
      expect(fetchResult.isError).toBe(true);
      const timerResult = await runProposalCode(`module.exports = async () => setTimeout(() => {}, 1);`, {});
      expect(timerResult.isError).toBe(true);
    });

    it('blocks code generation from strings (eval)', async () => {
      const code = `module.exports = async () => eval('1 + 1');`;
      const result = await runProposalCode(code, {});
      expect(result.isError).toBe(true);
    });

    it('isolates state between invocations', async () => {
      const code = `
        if (typeof counter === 'undefined') { counter = 0; }
        counter += 1;
        module.exports = async () => ({ content: String(counter) });
      `;
      const first = await runProposalCode(code, {});
      const second = await runProposalCode(code, {});
      expect(first.content).toBe('1');
      expect(second.content).toBe('1');
    });
  });

  describe('runProposalTests', () => {
    const echoCode = `module.exports = async (args) => ({ content: 'echo:' + args.text });`;

    it('passes when all expectations are met', async () => {
      const run = await runProposalTests({
        proposedCode: echoCode,
        testPlan: [
          { args: { text: 'a' }, expect: { equals: 'echo:a' } },
          { args: { text: 'bb' }, expect: { contains: 'bb' } },
        ],
      });
      expect(run.passed).toBe(true);
      expect(run.results).toHaveLength(2);
      expect(run.results.every((r) => r.passed)).toBe(true);
    });

    it('fails when an expectation is not met and records detail', async () => {
      const run = await runProposalTests({
        proposedCode: echoCode,
        testPlan: [{ args: { text: 'a' }, expect: { equals: 'echo:WRONG' } }],
      });
      expect(run.passed).toBe(false);
      expect(run.results[0].passed).toBe(false);
      expect(run.results[0].detail).toContain('actual: echo:a');
    });

    it('supports expecting an error result', async () => {
      const run = await runProposalTests({
        proposedCode: `module.exports = async () => { throw new Error('expected failure'); };`,
        testPlan: [{ args: {}, expect: { isError: true, contains: 'expected failure' } }],
      });
      expect(run.passed).toBe(true);
    });

    it('fails an unexpected error result', async () => {
      const run = await runProposalTests({
        proposedCode: `module.exports = async () => { throw new Error('boom'); };`,
        testPlan: [{ args: {}, expect: { contains: 'anything' } }],
      });
      expect(run.passed).toBe(false);
    });

    it('fails an empty testPlan', async () => {
      const run = await runProposalTests({ proposedCode: echoCode, testPlan: [] });
      expect(run.passed).toBe(false);
      expect(run.results[0].detail).toContain('testPlan is empty');
    });
  });
});
