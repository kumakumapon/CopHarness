import type { LLMAdapter, LLMRequest, LLMResponse } from '../adapter';
import { assertBudgetAvailable, recordBudgetUsage } from '../budget/budget';
import { getSkillExecutionContext } from '../utils/executionContext';

/** Budget enforcement is independent of optional telemetry. */
export class BudgetAdapter implements LLMAdapter {
  constructor(private readonly inner: LLMAdapter) {}
  get provider() { return this.inner.provider; }
  get model() { return this.inner.model; }
  get lastStreamUsage() { return this.inner.lastStreamUsage; }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const context = getSkillExecutionContext();
    assertBudgetAvailable(context);
    const response = await this.inner.complete(request);
    if (response.usage) recordBudgetUsage(this.provider, response.model ?? this.model, response.usage, context);
    return response;
  }

  async *stream(request: LLMRequest): AsyncGenerator<string> {
    if (!this.inner.stream) {
      yield (await this.complete(request)).content;
      return;
    }
    const context = getSkillExecutionContext();
    assertBudgetAvailable(context);
    yield* this.inner.stream(request);
    if (this.inner.lastStreamUsage) recordBudgetUsage(this.provider, this.model, this.inner.lastStreamUsage, context);
  }

  async destroy(): Promise<void> { await this.inner.destroy?.(); }
}
