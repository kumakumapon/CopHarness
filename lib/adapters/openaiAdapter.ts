import OpenAI from 'openai';
import { type LLMAdapter, type LLMRequest, type LLMResponse } from '../adapter';
import { type SkillDefinition, MAX_SKILL_ITERATIONS } from '../skill';
import { mergeAbortSignals } from '../utils/abort';

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
        return { content, model, provider: 'openai' };
      }

      // Append the assistant message with tool_calls
      messages.push({
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      });

      // Execute each tool call and append results
      for (const toolCall of message.tool_calls) {
        const skillName = toolCall.function.name;
        const skill = skillMap.get(skillName);
        let resultContent: string;
        if (skill) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
          } catch (parseErr) {
            console.warn(`[OpenAIAdapter] Failed to parse arguments for tool "${skillName}":`, parseErr);
          }
          const result = await skill.handler(args);
          resultContent = result.content;
        } else {
          resultContent = `Unknown skill: ${skillName}`;
        }
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: resultContent,
        });
      }
    }

    // Fallback: return empty content if loop exhausted without a text response
    console.warn('[OpenAIAdapter] MAX_SKILL_ITERATIONS reached without a text response');
    return { content: '', model, provider: 'openai' };
  }
}
