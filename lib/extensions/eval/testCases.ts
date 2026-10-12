/**
 * Evaluation test case definitions.
 *
 * A test case specifies a prompt to run through the harness and the criteria
 * used to score the response.  Three scoring modes are supported:
 *
 *   exact   – The response must equal `expected` (trimmed, case-insensitive).
 *   contains – The response must include `expected` as a substring.
 *   regex   – The response must match the `expected` regular expression.
 *   llm_judge – A secondary LLM call grades the response on a 0–10 scale.
 */

export type ScoringMode = 'exact' | 'contains' | 'regex' | 'llm_judge';

export interface EvalTestCase {
  /** Human-readable identifier for reporting. */
  name: string;
  /** User prompt sent to the harness. */
  prompt: string;
  /**
   * Scoring mode.
   * - exact / contains / regex: use `expected` to check the raw response.
   * - llm_judge: use `judgePrompt` to instruct the judge LLM.
   */
  mode: ScoringMode;
  /**
   * Reference string for exact / contains / regex modes.
   * For regex mode, this is the pattern string (no leading/trailing slashes).
   */
  expected?: string;
  /**
   * Custom prompt for the judge LLM in llm_judge mode.
   * The template variable `{{response}}` is replaced with the actual response.
   * The judge must reply with a single integer 0–10.
   */
  judgePrompt?: string;
  /**
   * Minimum score (0–1) for this test to be counted as a pass.
   * Defaults to 1.0 (exact/contains/regex) or 0.6 (llm_judge → score ≥ 6).
   */
  threshold?: number;
  /** Optional skill that is expected to be called in the response. */
  expectedSkill?: string;
}

/** Built-in test suite covering core skills and harness behaviour. */
export const builtinTestCases: EvalTestCase[] = [
  {
    name: 'currentDateTime – ISO format',
    prompt: 'What is the current date and time? Call the currentDateTime skill.',
    mode: 'regex',
    expected: '\\d{4}-\\d{2}-\\d{2}',
    expectedSkill: 'currentDateTime',
  },
  {
    name: 'calculator – basic arithmetic',
    prompt: 'Calculate 17 * 3 using the calculator skill.',
    mode: 'contains',
    expected: '51',
    expectedSkill: 'calculator',
  },
  {
    name: 'uuidGenerate – UUID format',
    prompt: 'Generate a UUID using the uuidGenerate skill.',
    mode: 'regex',
    expected: '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',
    expectedSkill: 'uuidGenerate',
  },
  {
    name: 'hashText – SHA256 hex output',
    prompt: 'Compute the SHA256 hash of the text "hello" using the hashText skill.',
    mode: 'contains',
    expected: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    expectedSkill: 'hashText',
  },
  {
    name: 'general knowledge – capitals',
    prompt: 'What is the capital of France?',
    mode: 'contains',
    expected: 'Paris',
    threshold: 1.0,
  },
  {
    name: 'response quality – explanation',
    prompt: 'Explain what a hash function does in two sentences.',
    mode: 'llm_judge',
    judgePrompt:
      'Does the following response correctly explain what a hash function does? ' +
      'Score 0–10, where 10 means a clear and correct explanation in roughly two sentences. ' +
      'Reply with ONLY a single integer.\n\nResponse: {{response}}',
    threshold: 0.6,
  },
];
