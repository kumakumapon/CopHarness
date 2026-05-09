/**
 * Shared wizard session manager for Discord / LINE bots.
 * Maintains per-channel/per-user state for the LLM-guided prompt wizard.
 *
 * Session keys:
 *   Discord → "discord:<channelId>"
 *   LINE    → "line:<userId>"
 */

import { type LLMAdapter } from './adapter';
import {
  getTemplateById,
  buildWizardSystemPrompt,
  promptTemplates,
} from './promptTemplates';

export { promptTemplates };

export type WizardStage = 'selecting' | 'collecting' | 'ready';

export interface WizardSession {
  stage: WizardStage;
  templateId?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  generatedPrompt?: string;
}

const sessions = new Map<string, WizardSession>();

export function getSession(key: string): WizardSession | undefined {
  return sessions.get(key);
}

export function clearSession(key: string): void {
  sessions.delete(key);
}

/** Put the user into template-selection mode and return the menu text. */
export function enterSelectingMode(key: string): string {
  sessions.set(key, { stage: 'selecting', messages: [] });
  const lines: string[] = [
    '🪄 「AIプロンプトウィザード」 — テンプレートを選択してください:',
    '',
  ];
  promptTemplates.forEach((t, i) => {
    lines.push(`${i + 1}. ${t.icon} ${t.nameJa} — ${t.descriptionJa}`);
  });
  lines.push('');
  lines.push('番号を入力してテンプレートを選択してください。');
  lines.push('キャンセルは「キャンセル」または「cancel」と入力してください。');
  return lines.join('\n');
}

/**
 * Select a template by 1-based index and get the first wizard question
 * from the LLM.
 */
export async function selectTemplate(
  key: string,
  indexOneBased: number,
  adapter: LLMAdapter,
): Promise<string> {
  const template = promptTemplates[indexOneBased - 1];
  if (!template) {
    return `番号が無効です。1〞${promptTemplates.length} の数字を入力してください。`;
  }

  const trigger = { role: 'user' as const, content: 'プロンプト作成を開始してください' };
  const session: WizardSession = {
    stage: 'collecting',
    templateId: template.id,
    messages: [trigger],
  };
  sessions.set(key, session);

  try {
    const systemPrompt = buildWizardSystemPrompt(template);
    const resp = await adapter.complete({
      messages: [{ role: 'system', content: systemPrompt }, trigger],
    });
    const reply = resp.content;
    session.messages.push({ role: 'assistant', content: reply });
    return `🪄 「${template.nameJa}」のプロンプトを作成します\n\n${stripCollected(reply)}`;
  } catch (err) {
    sessions.delete(key);
    return `エラーが発生しました: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export type WizardContinueResult =
  | { type: 'reply'; text: string }
  | { type: 'complete'; text: string; generatedPrompt: string }
  | { type: 'error'; text: string };

/** Continue the wizard conversation with the user's latest message. */
export async function continueWizard(
  key: string,
  userMessage: string,
  adapter: LLMAdapter,
): Promise<WizardContinueResult> {
  const session = sessions.get(key);
  if (!session || session.stage !== 'collecting' || !session.templateId) {
    return { type: 'error', text: 'ウィザードセッションが見つかりません。' };
  }

  const template = getTemplateById(session.templateId);
  if (!template) {
    sessions.delete(key);
    return { type: 'error', text: 'テンプレートが見つかりません。' };
  }

  session.messages.push({ role: 'user', content: userMessage });

  try {
    const systemPrompt = buildWizardSystemPrompt(template);
    const resp = await adapter.complete({
      messages: [{ role: 'system', content: systemPrompt }, ...session.messages],
    });
    const reply = resp.content;
    session.messages.push({ role: 'assistant', content: reply });

    const match = reply.match(/<COLLECTED>([\s\S]*?)<\/COLLECTED>/);
    if (match) {
      try {
        const values = JSON.parse(match[1].trim()) as Record<string, string>;
        const generatedPrompt = template.buildPrompt(values);
        session.stage = 'ready';
        session.generatedPrompt = generatedPrompt;
        return { type: 'complete', text: stripCollected(reply), generatedPrompt };
      } catch {
        // JSON parse failed — treat as incomplete
      }
    }

    return { type: 'reply', text: stripCollected(reply) };
  } catch (err) {
    return {
      type: 'error',
      text: `エラーが発生しました: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function stripCollected(content: string): string {
  return content.replace(/<COLLECTED>[\s\S]*?<\/COLLECTED>/g, '').trim();
}
