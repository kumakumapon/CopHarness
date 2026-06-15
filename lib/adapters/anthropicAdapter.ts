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

  async *stream(request: LLMRequest): AsyncGenerator<string> {
    const model = request.model ?? this.model;
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;
    const skills = request.skills ?? [];

    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const systemPrompt = systemMessages.map((m) => m.content).join('\n');
    const conversationMessages = request.messages.filter((m) => m.role !== 'system');

    type AnthropicMsg = { role: string; content: string | AnthropicContentBlock[] };
    const messages: AnthropicMsg[] = conversationMessages.map((m, idx) => {
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
        stream: true,
      };
      if (systemPrompt) body['system'] = systemPrompt;
      if (tools.length > 0) body['tools'] = tools;

      const { signal, cleanup } = mergeAbortSignals(timeoutMs, request.abortSignal);
      let resp: Response;
      try {
        resp = await fetch(`${this.baseUrl}/v1/messages`, {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
        });
      } finally {
        cleanup();
      }

      if (!resp.ok) {
        const text = await resp.text().catch(() => resp.statusText);
        throw Object.assign(new Error(`Anthropic API error: ${text}`), { status: resp.status });
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      type StreamBlock = {
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: string;
      };
      const contentBlocks: StreamBlock[] = [];
      let stopReason: string | undefined;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (!data || data === '[DONE]') continue;

            let event: Record<string, unknown>;
            try {
              event = JSON.parse(data) as Record<string, unknown>;
            } catch {
              continue;
            }

            if (event['type'] === 'content_block_start') {
              const idx = event['index'] as number;
              const block = event['content_block'] as Record<string, unknown>;
              contentBlocks[idx] = { type: String(block['type'] ?? '') };
              if (block['type'] === 'tool_use') {
                contentBlocks[idx].id = String(block['id'] ?? '');
                contentBlocks[idx].name = String(block['name'] ?? '');
                contentBlocks[idx].input = '';
              }
            } else if (event['type'] === 'content_block_delta') {
              const idx = event['index'] as number;
              const delta = event['delta'] as Record<string, unknown>;
              if (delta['type'] === 'text_delta') {
                const text = String(delta['text'] ?? '');
                yield text;
                if (!contentBlocks[idx]) contentBlocks[idx] = { type: 'text', text: '' };
                contentBlocks[idx].text = (contentBlocks[idx].text ?? '') + text;
              } else if (delta['type'] === 'input_json_delta') {
                if (contentBlocks[idx]) {
                  contentBlocks[idx].input =
                    (contentBlocks[idx].input ?? '') + String(delta['partial_json'] ?? '');
                }
              }
            } else if (event['type'] === 'message_delta') {
              const d = event['delta'] as Record<string, unknown>;
              stopReason = String(d['stop_reason'] ?? '');
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (stopReason !== 'tool_use') return;

      const toolUseBlocks = contentBlocks.filter((b) => b.type === 'tool_use');
      messages.push({
        role: 'assistant',
        content: contentBlocks.map((b) => {
          if (b.type === 'text') return { type: 'text', text: b.text ?? '' } as AnthropicContentBlock;
          return {
            type: 'tool_use',
            id: b.id ?? '',
            name: b.name ?? '',
            input: (() => {
              try { return JSON.parse(b.input ?? '{}') as Record<string, unknown>; }
              catch { return {}; }
            })(),
          } as AnthropicContentBlock;
        }),
      });

      const toolResultsSettled = await Promise.allSettled(
        toolUseBlocks.map(async (block) => {
          const skill = skillMap.get(block.name ?? '');
          if (skill) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(block.input ?? '{}') as Record<string, unknown>; } catch { /* ignore */ }
            const result = await skill.handler(args);
            return {
              type: 'tool_result' as const,
              tool_use_id: block.id ?? '',
              content: result.content,
              ...(result.isError ? { is_error: true } : {}),
            };
          }
          return {
            type: 'tool_result' as const,
            tool_use_id: block.id ?? '',
            content: `Unknown skill: ${block.name ?? ''}`,
            is_error: true,
          };
        }),
      );
      const toolResults: AnthropicContentBlock[] = toolResultsSettled.map((r) =>
        r.status === 'fulfilled'
          ? (r.value as AnthropicContentBlock)
          : ({ type: 'tool_result', tool_use_id: '', content: `Tool execution failed: ${r.reason}`, is_error: true } as AnthropicContentBlock),
      );
      messages.push({ role: 'user', content: toolResults });
    }
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
      let data: { content: AnthropicContentBlock[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
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
        const usage = data.usage
          ? {
              promptTokens: data.usage.input_tokens,
              completionTokens: data.usage.output_tokens,
              totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
            }
          : undefined;
        return { content, model, provider: 'anthropic', usage };
      }

      // Append the assistant message containing tool_use blocks
      messages.push({ role: 'assistant', content: data.content });

      // Execute tool calls in parallel for better performance
      const completeToolSettled = await Promise.allSettled(
        toolUseBlocks.map(async (block) => {
          const skill = skillMap.get(block.name);
          if (skill) {
            const result = await skill.handler(block.input);
            return {
              type: 'tool_result' as const,
              tool_use_id: block.id,
              content: result.content,
              ...(result.isError ? { is_error: true } : {}),
            };
          }
          return {
            type: 'tool_result' as const,
            tool_use_id: block.id,
            content: `Unknown skill: ${block.name}`,
            is_error: true,
          };
        }),
      );
      const toolResults: AnthropicContentBlock[] = completeToolSettled.map((r) =>
        r.status === 'fulfilled'
          ? (r.value as AnthropicContentBlock)
          : ({ type: 'tool_result', tool_use_id: '', content: `Tool execution failed: ${r.reason}`, is_error: true } as AnthropicContentBlock),
      );
      messages.push({ role: 'user', content: toolResults });
    }

    // Fallback: return empty content if loop exhausted without a text response
    console.warn('[AnthropicAdapter] MAX_SKILL_ITERATIONS reached without a text response');
    return { content: '', model, provider: 'anthropic' };
  }
}
