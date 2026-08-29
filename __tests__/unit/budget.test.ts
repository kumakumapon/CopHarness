import { assertBudgetAvailable, BudgetExceededError, getBudgetSummary, recordBudgetUsage, _resetBudgetsForTests } from '../../lib/telemetry/budget';

const original = { ...process.env };

beforeEach(() => {
  _resetBudgetsForTests();
  delete process.env.BUDGET_MAX_TOKENS;
  delete process.env.BUDGET_MAX_COST_USD;
  delete process.env.BUDGET_USER_MAX_TOKENS;
  delete process.env.BUDGET_USER_MAX_COST_USD;
  delete process.env.BUDGET_TASK_MAX_TOKENS;
  delete process.env.BUDGET_TASK_MAX_COST_USD;
});

afterAll(() => {
  process.env = original;
});

describe('LLM budget enforcement', () => {
  it('blocks a user after its daily token budget is spent', () => {
    process.env.BUDGET_USER_MAX_TOKENS = '10';
    recordBudgetUsage('openai', 'gpt-4o', { totalTokens: 10 }, { personId: 'person_1' });
    expect(() => assertBudgetAvailable({ personId: 'person_1' })).toThrow(BudgetExceededError);
    expect(() => assertBudgetAvailable({ personId: 'person_2' })).not.toThrow();
  });

  it('blocks a task without blocking another task', () => {
    process.env.BUDGET_TASK_MAX_TOKENS = '5';
    recordBudgetUsage('openai', 'gpt-4o', { totalTokens: 5 }, { taskId: 'task_1' });
    expect(() => assertBudgetAvailable({ taskId: 'task_1' })).toThrow(BudgetExceededError);
    expect(() => assertBudgetAvailable({ taskId: 'task_2' })).not.toThrow();
  });

  it('blocks the global daily cost budget', () => {
    process.env.BUDGET_MAX_COST_USD = '0.01';
    recordBudgetUsage('openai', 'gpt-4o', { promptTokens: 4000, totalTokens: 4000 });
    expect(() => assertBudgetAvailable()).toThrow(BudgetExceededError);
  });
});


it('reports a warning when global daily usage reaches 80 percent', () => {
  process.env.BUDGET_MAX_TOKENS = '100';
  recordBudgetUsage('openai', 'gpt-4o', { totalTokens: 80 });
  expect(getBudgetSummary().utilization.tokens).toBeCloseTo(0.8);
  expect(getBudgetSummary().warnings).toContain('Global daily token budget is at or above 80%.');
});
