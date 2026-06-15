import OpenAI from 'openai';
import { type LLMAdapter, type LLMRequest, type LLMResponse } from '../adapter';
import { type SkillDefinition, MAX_SKILL_ITERATIONS } from '../skill';
import { mergeAbortSignals } from '../utils/abort';
import { withContextFallback } from '../utils/contextRetry';

/** Convert a SkillDefinition to the OpenAI tool format. */
function skillToOpenAITool(skill: SkillDefinition): OpenAI.Chat.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: skill.name,
      description: skill.description,
      parameters: skill.parameters as unknown as Record<string, unknown>,
    },
  };
}

export class OpenAIAdapter implements LLMAdapter {
  readonly provider = 'openai';
  readonly model: string;
  private readonly client: OpenAI;
  private readonly timeoutMs: number;

  constructor(model: string, apiKey: string, apiBaseUrl?: string, timeoutMs = 30_000) {
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.client = new OpenAI({
      apiKey,
      baseURL: apiBaseUrl,
      timeout: timeoutMs,
    });
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return withContextFallback(
      (messages) => this._complete({ ...request, messages }),
      request.messages,
    );
  }

  async *stream(request: LLMRequest): AsyncGenerator<string> {
    const model = request.model ?? this.model;
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;
    const skills = request.skills ?? [];

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = request.messages.map(
      (m, idx) => {
        const isLastUser = m.role === 'user' && idx === request.messages.length - 1;
        if (isLastUser && request.attachments && request.attachments.length > 0) {
          const content: OpenAI.Chat.ChatCompletionContentPart[] = [
            { type: 'text', text: m.content },
            ...request.attachments.map((att) => ({
              type: 'image_url' as const,
              image_url: { url: `data:${att.mimeType};base64,${att.data}` },
            })),
          ];
          return { role: 'user' as const, content };
        }
        return { role: m.role as 'user' | 'assistant' | 'system', content: m.content };
      },
    );

    const tools = skills.map(skillToOpenAITool);
    const skillMap = new Map(skills.map((s) => [s.name, s]));

    for (let iteration = 0; iteration < MAX_SKILL_ITERATIONS; iteration++) {
      const { signal, cleanup } = mergeAbortSignals(timeoutMs, request.abortSignal);
      try {
        const stream = await this.client.chat.completions.create(
          {
            model,
            messages,
            stream: true,
            ...(tools.length > 0 ? { tools } : {}),
          },
          { signal },
        );

        let textContent = '';
        const toolCallData: Record<number, { id: string; name: string; args: string }> = {};

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            yield delta.content;
            textContent += delta.content;
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallData[idx]) {
                toolCallData[idx] = { id: '', name: '', args: '' };
              }
              if (tc.id) toolCallData[idx].id = tc.id;
              if (tc.function?.name) toolCallData[idx].name += tc.function.name;
              if (tc.function?.arguments) toolCallData[idx].args += tc.function.arguments;
            }
          }
        }

        const toolCallCount = Object.keys(toolCallData).length;
        if (toolCallCount === 0) return;

        const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = Object.entries(
          toolCallData,
        ).map(([i, tc]) => ({
          id: tc.id || `call_${i}`,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.args },
        }));

        messages.push({
          role: 'assistant',
          content: textContent || null,
          tool_calls: toolCalls,
        });

        const streamToolResults = await Promise.allSettled(
          toolCalls.map(async (tc) => {
            const skill = skillMap.get(tc.function.name);
            if (skill) {
              let args: Record<string, unknown> = {};
              try { args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>; } catch { /* ignore */ }
              const result = await skill.handler(args);
              return { id: tc.id, content: result.content };
            }
            return { id: tc.id, content: `Unknown skill: ${tc.function.name}` };
          }),
        );
        for (const r of streamToolResults) {
          const val = r.status === 'fulfilled'
            ? r.value
            : { id: '', content: `Tool execution failed: ${r.reason}` };
          messages.push({ role: 'tool', tool_call_id: val.id, content: val.content });
        }
      } finally {
        cleanup();
      }
    }
  }

  private async _complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? this.model;
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;
    const skills = request.skills ?? [];

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = request.messages.map((m, idx) => {
      const isLastUser = m.role === 'user' && idx === request.messages.length - 1;
      if (isLastUser && request.attachments && request.attachments.length > 0) {
        const content: OpenAI.Chat.ChatCompletionContentPart[] = [
          { type: 'text', text: m.content },
          ...request.attachments.map((att) => ({
            type: 'image_url' as const,
            image_url: { url: `data:${att.mimeType};base64,${att.data}` },
          })),
        ];
        return { role: 'user' as const, content };
      }
      return { role: m.role as 'user' | 'assistant' | 'system', content: m.content };
    });

    const tools = skills.map(skillToOpenAITool);
    const skillMap = new Map(skills.map((s) => [s.name, s]));

    for (let iteration = 0; iteration < MAX_SKILL_ITERATIONS; iteration++) {
      const { signal, cleanup } = mergeAbortSignals(timeoutMs, request.abortSignal);
      let completion: OpenAI.Chat.ChatCompletion;
      try {
        completion = await this.client.chat.completions.create(
          {
            model,
            messages,
            ...(tools.length > 0 ? { tools } : {}),
          },
          { signal },
        );
      } finally {
        cleanup();
      }

      const choice = completion.choices[0];
      const message = choice?.message;

      if (!message) break;

      // No tool calls – return the text response
      if (!message.tool_calls || message.tool_calls.length === 0) {
        const content = message.content ?? '';
        const usage = completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens,
              completionTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens,
            }
          : undefined;
        return { content, model, provider: 'openai', usage };
      }

      // Append the assistant message with tool_calls
      messages.push({
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      });

      // Execute tool calls in parallel for better performance
      const toolResults = await Promise.allSettled(
        message.tool_calls.map(async (toolCall) => {
          const skillName = toolCall.function.name;
          const skill = skillMap.get(skillName);
          if (skill) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
            } catch (parseErr) {
              console.warn(`[OpenAIAdapter] Failed to parse arguments for tool "${skillName}":`, parseErr);
            }
            const result = await skill.handler(args);
            return { toolCallId: toolCall.id, content: result.content };
          }
          return { toolCallId: toolCall.id, content: `Unknown skill: ${skillName}` };
        }),
      );
      for (const result of toolResults) {
        const value = result.status === 'fulfilled'
          ? result.value
          : { toolCallId: '', content: `Tool execution failed: ${result.reason}` };
        messages.push({
          role: 'tool',
          tool_call_id: value.toolCallId,
          content: value.content,
        });
      }
    }

    // Fallback: return empty content if loop exhausted without a text response
    console.warn('[OpenAIAdapter] MAX_SKILL_ITERATIONS reached without a text response');
    return { content: '', model, provider: 'openai' };
  }
}
