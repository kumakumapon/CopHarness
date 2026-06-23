/**
 * Unit tests for lib/agents/agentLoop.ts
 *
 * Covers:
 * - Immediate completion when markComplete is called on the first iteration
 * - Looping until markComplete is called on a later iteration
 * - Stopping at maxIterations when markComplete is never called
 * - Stuck-state detection (no tools + very short response for 2 consecutive rounds)
 * - onProgress callback via the reportProgress control skill
 * - onToolCall / onToolResult callbacks via custom user-provided skills
 * - AbortSignal stops the loop before or during execution
 * - requestUserInput delegates to the onRequestInput callback
 */

import { runAgentLoop } from '../../lib/agents/agentLoop';
import type { AgentLoopCallbacks, AgentLoopOptions } from '../../lib/agents/agentLoop';
import type { LLMAdapter, LLMRequest } from '../../lib/adapter';
import type { SkillDefinition } from '../../lib/skill';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

jest.mock('../../lib/context/compactor', () => ({
  needsCompaction: jest.fn(() => false),
  compactMessages: jest.fn(async (msgs: unknown[]) => msgs),
}));

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeMockAdapter(
  completeFn: (request: LLMRequest) => Promise<{ content: string }>,
): LLMAdapter {
  return {
    provider: 'mock',
    model: 'mock-model',
    complete: jest.fn(completeFn),
  };
}

function makeBaseOptions(
  overrides: Partial<AgentLoopOptions> = {},
): AgentLoopOptions {
  return {
    goal: 'Test goal',
    adapter: makeMockAdapter(async () => ({ content: 'Thinking…' })),
    maxIterations: 10,
    ...overrides,
  };
}

function makeSimpleSkill(name: string): SkillDefinition {
  return {
    name,
    description: `A simple skill named ${name}`,
    parameters: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'A value' },
      },
    },
    category: 'utility',
    riskLevel: 'low',
    handler: jest.fn(async (_args) => ({ content: `Result from ${name}` })),
  };
}

// ---------------------------------------------------------------------------
// afterEach cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Completes immediately when markComplete is called on the first iteration
// ---------------------------------------------------------------------------

describe('runAgentLoop – immediate completion', () => {
  it('returns completed=true and sets summary when markComplete is called on first iteration', async () => {
    const adapter = makeMockAdapter(async (request) => {
      const markComplete = request.skills?.find((s) => s.name === 'markComplete');
      if (markComplete) {
        await markComplete.handler({ summary: 'Done on first try' });
      }
      return { content: 'I have completed the task.' };
    });

    const result = await runAgentLoop(makeBaseOptions({ adapter }));

    expect(result.completed).toBe(true);
    expect(result.summary).toBe('Done on first try');
    // markComplete was invoked before the loop incremented; iteration counter stays at 0
    expect(result.iterations).toBe(0);
    expect(result.toolCallCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Loops until markComplete is called on a later iteration
// ---------------------------------------------------------------------------

describe('runAgentLoop – loops until markComplete', () => {
  it('returns completed=true after markComplete is called on the second invocation', async () => {
    let callCount = 0;

    const adapter = makeMockAdapter(async (request) => {
      callCount++;
      if (callCount >= 2) {
        const markComplete = request.skills?.find((s) => s.name === 'markComplete');
        if (markComplete) {
          await markComplete.handler({ summary: 'Finished after looping' });
        }
        return { content: 'Task complete now.' };
      }
      // First iteration: return substantial text without calling any skill
      return { content: 'Still working on it, please hold.' };
    });

    const result = await runAgentLoop(makeBaseOptions({ adapter }));

    expect(result.completed).toBe(true);
    expect(result.summary).toBe('Finished after looping');
    // The loop counter incremented once before the second adapter call
    expect(result.iterations).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Stops at maxIterations when markComplete is never called
// ---------------------------------------------------------------------------

describe('runAgentLoop – maxIterations', () => {
  it('returns completed=false and the correct iteration count when limit is reached', async () => {
    const adapter = makeMockAdapter(async () => ({
      content: 'Still thinking, not done yet at all.',
    }));

    const result = await runAgentLoop(
      makeBaseOptions({ adapter, maxIterations: 3 }),
    );

    expect(result.completed).toBe(false);
    expect(result.iterations).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 4. Detects stuck state (no tools + very short response for 2 consecutive rounds)
// ---------------------------------------------------------------------------

describe('runAgentLoop – stuck detection', () => {
  it('breaks early when adapter returns empty string twice with no tool calls', async () => {
    // Return a truly short (< 5 chars) empty-ish response every time, never calling skills.
    const adapter = makeMockAdapter(async () => ({ content: '' }));

    const result = await runAgentLoop(
      makeBaseOptions({ adapter, maxIterations: 10 }),
    );

    // Should break well before 10 iterations
    expect(result.completed).toBe(false);
    expect(result.iterations).toBeLessThan(10);
  });

  it('resets the stuck counter when a tool is called between short responses', async () => {
    let callCount = 0;

    const adapter = makeMockAdapter(async (request) => {
      callCount++;
      if (callCount === 2) {
        // Call a control skill on iteration 2 to reset the counter
        const reportProgress = request.skills?.find((s) => s.name === 'reportProgress');
        if (reportProgress) {
          await reportProgress.handler({ message: 'Still alive' });
        }
      }
      // All responses are short but the tool call on round 2 resets consecutiveEmptyRounds
      return { content: '' };
    });

    const result = await runAgentLoop(
      makeBaseOptions({ adapter, maxIterations: 10 }),
    );

    // Should run past what a pure stuck-state detection would allow (>2 iterations)
    expect(result.iterations).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 5. onProgress callback via reportProgress
// ---------------------------------------------------------------------------

describe('runAgentLoop – onProgress callback', () => {
  it('calls onProgress with the message passed to reportProgress', async () => {
    const onProgress = jest.fn();

    const adapter = makeMockAdapter(async (request) => {
      const reportProgress = request.skills?.find((s) => s.name === 'reportProgress');
      if (reportProgress) {
        await reportProgress.handler({ message: 'Halfway there' });
      }
      const markComplete = request.skills?.find((s) => s.name === 'markComplete');
      if (markComplete) {
        await markComplete.handler({ summary: 'All done' });
      }
      return { content: 'Reported progress and completed.' };
    });

    const callbacks: AgentLoopCallbacks = { onProgress };
    await runAgentLoop(makeBaseOptions({ adapter, callbacks }));

    expect(onProgress).toHaveBeenCalledWith('Halfway there');
  });
});

// ---------------------------------------------------------------------------
// 6. onToolCall and onToolResult callbacks for user-provided skills
// ---------------------------------------------------------------------------

describe('runAgentLoop – onToolCall / onToolResult callbacks', () => {
  it('fires onToolCall and onToolResult when a custom skill is invoked', async () => {
    const onToolCall = jest.fn();
    const onToolResult = jest.fn();

    const customSkill = makeSimpleSkill('myTool');

    const adapter = makeMockAdapter(async (request) => {
      // On the first call, invoke the custom skill then complete
      const myTool = request.skills?.find((s) => s.name === 'myTool');
      if (myTool) {
        await myTool.handler({ value: 'hello' });
      }
      const markComplete = request.skills?.find((s) => s.name === 'markComplete');
      if (markComplete) {
        await markComplete.handler({ summary: 'Used the tool' });
      }
      return { content: 'Called myTool and finished.' };
    });

    const callbacks: AgentLoopCallbacks = { onToolCall, onToolResult };
    await runAgentLoop(makeBaseOptions({ adapter, skills: [customSkill], callbacks }));

    // onToolCall should have been fired for 'myTool'
    expect(onToolCall).toHaveBeenCalledWith('myTool', { value: 'hello' });

    // onToolResult should have been fired with the result content and no error
    expect(onToolResult).toHaveBeenCalledWith('myTool', 'Result from myTool', false);
  });

  it('reports isError=true via onToolResult when the skill handler throws', async () => {
    const onToolResult = jest.fn();

    const failingSkill: SkillDefinition = {
      name: 'failingTool',
      description: 'A skill that throws',
      parameters: { type: 'object', properties: {} },
      category: 'utility',
      riskLevel: 'low',
      handler: jest.fn(async () => {
        throw new Error('Tool exploded');
      }),
    };

    const adapter = makeMockAdapter(async (request) => {
      const failingTool = request.skills?.find((s) => s.name === 'failingTool');
      if (failingTool) {
        await failingTool.handler({});
      }
      const markComplete = request.skills?.find((s) => s.name === 'markComplete');
      if (markComplete) {
        await markComplete.handler({ summary: 'Done despite error' });
      }
      return { content: 'Finished.' };
    });

    const callbacks: AgentLoopCallbacks = { onToolResult };
    await runAgentLoop(makeBaseOptions({ adapter, skills: [failingSkill], callbacks }));

    expect(onToolResult).toHaveBeenCalledWith('failingTool', 'Tool exploded', true);
  });
});

// ---------------------------------------------------------------------------
// 7. AbortSignal stops the loop
// ---------------------------------------------------------------------------

describe('runAgentLoop – AbortSignal', () => {
  it('returns completed=false immediately when already aborted before the loop starts', async () => {
    const controller = new AbortController();
    controller.abort();

    const adapter = makeMockAdapter(async () => ({ content: 'This should never run.' }));

    const result = await runAgentLoop(
      makeBaseOptions({ adapter, abortSignal: controller.signal }),
    );

    expect(result.completed).toBe(false);
    expect(adapter.complete).not.toHaveBeenCalled();
    expect(result.iterations).toBe(0);
  });

  it('returns completed=false when aborted between iterations', async () => {
    const controller = new AbortController();
    let callCount = 0;

    const adapter = makeMockAdapter(async () => {
      callCount++;
      if (callCount === 1) {
        // Abort after the first complete() returns
        controller.abort();
      }
      return { content: 'Some substantial response text here.' };
    });

    const result = await runAgentLoop(
      makeBaseOptions({ adapter, abortSignal: controller.signal, maxIterations: 10 }),
    );

    expect(result.completed).toBe(false);
    // complete() was called once before the abort was observed
    expect(adapter.complete).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 8. requestUserInput delegates to onRequestInput callback
// ---------------------------------------------------------------------------

describe('runAgentLoop – requestUserInput', () => {
  it('calls onRequestInput and returns its answer to the skill caller', async () => {
    const onRequestInput = jest.fn(async (_question: string) => 'User said: yes');

    let capturedSkillResult: string | undefined;

    const adapter = makeMockAdapter(async (request) => {
      const requestUserInput = request.skills?.find((s) => s.name === 'requestUserInput');
      if (requestUserInput) {
        const result = await requestUserInput.handler({ question: 'Are you sure?' });
        capturedSkillResult = result.content;
      }
      const markComplete = request.skills?.find((s) => s.name === 'markComplete');
      if (markComplete) {
        await markComplete.handler({ summary: 'Got user input' });
      }
      return { content: 'Requested input and completed.' };
    });

    const callbacks: AgentLoopCallbacks = { onRequestInput };
    await runAgentLoop(makeBaseOptions({ adapter, callbacks }));

    expect(onRequestInput).toHaveBeenCalledWith('Are you sure?');
    expect(capturedSkillResult).toBe('User said: yes');
  });

  it('returns a fallback message when onRequestInput is not provided', async () => {
    let capturedSkillResult: string | undefined;

    const adapter = makeMockAdapter(async (request) => {
      const requestUserInput = request.skills?.find((s) => s.name === 'requestUserInput');
      if (requestUserInput) {
        const result = await requestUserInput.handler({ question: 'Need info?' });
        capturedSkillResult = result.content;
      }
      const markComplete = request.skills?.find((s) => s.name === 'markComplete');
      if (markComplete) {
        await markComplete.handler({ summary: 'Finished without input' });
      }
      return { content: 'Done.' };
    });

    // No callbacks.onRequestInput provided
    await runAgentLoop(makeBaseOptions({ adapter }));

    expect(capturedSkillResult).toBe('User input not available in this mode.');
  });
});

// ---------------------------------------------------------------------------
// 9. toolCallCount is accurate across control and custom skills
// ---------------------------------------------------------------------------

describe('runAgentLoop – toolCallCount', () => {
  it('counts calls to both control skills and user skills', async () => {
    const customSkill = makeSimpleSkill('counter');

    const adapter = makeMockAdapter(async (request) => {
      const counterSkill = request.skills?.find((s) => s.name === 'counter');
      if (counterSkill) {
        await counterSkill.handler({ value: 'x' });
      }
      const reportProgress = request.skills?.find((s) => s.name === 'reportProgress');
      if (reportProgress) {
        await reportProgress.handler({ message: 'tick' });
      }
      const markComplete = request.skills?.find((s) => s.name === 'markComplete');
      if (markComplete) {
        await markComplete.handler({ summary: 'done' });
      }
      return { content: 'All skills called.' };
    });

    const result = await runAgentLoop(
      makeBaseOptions({ adapter, skills: [customSkill] }),
    );

    // counter (1) + reportProgress (1) + markComplete (1) = 3
    expect(result.toolCallCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 10. durationMs is non-negative
// ---------------------------------------------------------------------------

describe('runAgentLoop – durationMs', () => {
  it('returns a non-negative durationMs', async () => {
    const adapter = makeMockAdapter(async (request) => {
      const markComplete = request.skills?.find((s) => s.name === 'markComplete');
      if (markComplete) {
        await markComplete.handler({ summary: 'fast' });
      }
      return { content: 'Quick.' };
    });

    const result = await runAgentLoop(makeBaseOptions({ adapter }));

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
