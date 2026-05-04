import { type LLMAdapter, type LLMRequest, type LLMResponse } from '../adapter';
import { type SkillDefinition, MAX_SKILL_ITERATIONS } from '../skill';
import { mergeAbortSignals } from '../utils/abort';
import { withContextFallback } from '../utils/contextRetry';

/** Anthropic tool definition shape. */
interface AnthropicTool {
  name: string;
  description: string;
  input_schema: SkillDefinition['parameters'];
}

/** A content block in an Anthropic message. */
type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export class AnthropicAdapter implements LLMAdapter {
  readonly provider = 'anthropic';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(model: string, apiKey: string, baseUrl = 'https://api.anthropic.com', timeoutMs = 30_000) {
    this.model = model;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return withContextFallback(
      (messages) => this._complete({ ...request, messages }),
      request.messages,
    );
  }

  private async _complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? this.model;
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;
    const skills = request.skills ?? [];

    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const systemPrompt = systemMessages.map((m) => m.content).join('\n');
    const conversationMessages = request.messages.filter((m) => m.role !== 'system');

    type AnthropicMessage = { role: string; content: string | AnthropicContentBlock[] };
    const messages: AnthropicMessage[] = conversationMessages.map((m, idx) => {
      const isLastUser = m.role === 'user' && idx === conversationMessages.length - 1;
      if (isLastUser && request.attachments && request.attachments.length > 0) {
        const content: unknown[] = [{ type: 'text', text: m.content }];
        for (const att of request.attachments) {
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: att.mimeType, data: att.data },
          });
        }
        return { role: m.role, content: content as AnthropicContentBlock[] };
      }
      return { role: m.role, content: m.content };
    });

    const tools: AnthropicTool[] = skills.map((s) => ({
      name: s.name,
      description: s.description,
      input_schema: s.parameters,
    }));
    const skillMap = new Map(skills.map((s) => [s.name, s]));

    for (let iteration = 0; iteration < MAX_SKILL_ITERATIONS; iteration++) {
      const body: Record<string, unknown> = {
        model,
        max_tokens: 4096,
        messages,
      };
      if (systemPrompt) body.system = systemPrompt;
      if (tools.length > 0) body.tools = tools;

      const { signal, cleanup } = mergeAbortSignals(timeoutMs, request.abortSignal);
      let data: { content: AnthropicContentBlock[]; stop_reason?: string };
      try {
        const resp = await fetch(`${this.baseUrl}/v1/messages`, {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => resp.statusText);
          const err = Object.assign(new Error(`Anthropic API error: ${text}`), { status: resp.status });
          throw err;
        }
        data = (await resp.json()) as { content: AnthropicContentBlock[]; stop_reason?: string };
      } finally {
        cleanup();
      }

      const toolUseBlocks = data.content.filter(
        (c): c is Extract<AnthropicContentBlock, { type: 'tool_use' }> => c.type === 'tool_use',
      );

      // No tool calls – return the text response
      if (toolUseBlocks.length === 0 || data.stop_reason !== 'tool_use') {
        const content = data.content
          .filter((c): c is Extract<AnthropicContentBlock, { type: 'text' }> => c.type === 'text')
          .map((c) => c.text)
          .join('');
        return { content, model, provider: 'anthropic' };
      }

      // Append the assistant message containing tool_use blocks
      messages.push({ role: 'assistant', content: data.content });

      // Execute each tool use and append results as a single user message
      const toolResults: AnthropicContentBlock[] = [];
      for (const block of toolUseBlocks) {
        const skill = skillMap.get(block.name);
        let resultContent: string;
        let isError = false;
        if (skill) {
          const result = await skill.handler(block.input);
          resultContent = result.content;
          isError = result.isError ?? false;
        } else {
          resultContent = `Unknown skill: ${block.name}`;
          isError = true;
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: resultContent,
          ...(isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    // Fallback: return empty content if loop exhausted without a text response
    console.warn('[AnthropicAdapter] MAX_SKILL_ITERATIONS reached without a text response');
    return { content: '', model, provider: 'anthropic' };
  }
}
