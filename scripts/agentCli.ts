/**
 * CopHarness Agent CLI
 * Enhanced interactive CLI supporting both normal chat and agent mode.
 *
 * Usage:
 *   npm run agent-cli
 *
 * Slash commands:
 *   /agent <goal>     - Run the agent loop toward a goal
 *   /skills           - List available skills
 *   /model <name>     - Switch model mid-session
 *   /provider <name>  - Switch provider mid-session
 *   /compact          - Manually compact conversation context
 *   /clear            - Clear conversation history
 *   /help             - Show available commands
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// Load .env.local if present (dev convenience)
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

import { createAdapterWithFallback, resolveProvider, resolveModel, resolveApiKey } from '../lib/adapterFactory';
import { type LLMAdapter, type LLMMessage, type ProviderType } from '../lib/adapter';
import {
  saveConversation,
  loadConversation,
  listConversations,
  deleteConversation,
} from '../lib/history/conversationPersistence';
import '../lib/skills/index';
import { listActiveSkills } from '../lib/skill';
import { runAgentLoop, type AgentLoopCallbacks, type AgentLoopResult } from '../lib/agents/agentLoop';
import { compactMessages, estimateConversationTokens } from '../lib/context/compactor';

const LOCAL_PROVIDERS: ProviderType[] = ['copilot', 'lmstudio', 'lemonade'];

function buildAdapter(provider: ProviderType, model: string, apiKey: string | undefined): LLMAdapter {
  const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;
  return createAdapterWithFallback({ provider, model, apiKey, timeoutMs });
}

function argsToSummary(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '';
  const parts = entries.map(([k, v]) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    const short = s.length > 40 ? s.slice(0, 40) + '…' : s;
    return `${k}: ${short}`;
  });
  return parts.join(', ');
}

function printHelp(): void {
  console.log(`
Available commands:
  /agent <goal>       Run the agent loop toward a specific goal
  /skills             List available skills with names and risk levels
  /model <name>       Switch to a different model mid-session
  /provider <name>    Switch to a different provider mid-session
  /compact            Manually compact conversation context
  /clear              Clear conversation history
  /save [title]       Save the current conversation (auto-title if omitted)
  /load <id>          Load a saved conversation, replacing current messages
  /conversations      List saved conversations
  /list               Alias for /conversations
  /delete <id>        Delete a saved conversation
  /autosave           Toggle auto-save after each exchange
  /help               Show this help message
  exit / quit         Exit the CLI (auto-saves if there are messages)
`);
}

function printSkills(): void {
  const skills = listActiveSkills();
  if (skills.length === 0) {
    console.log('No active skills registered.\n');
    return;
  }
  console.log(`\nActive skills (${skills.length}):`);
  const maxNameLen = Math.max(...skills.map((s) => s.name.length));
  for (const skill of skills) {
    const name = skill.name.padEnd(maxNameLen + 2);
    const risk = (skill.riskLevel ?? 'low').padEnd(6);
    const category = skill.category ?? 'utility';
    console.log(`  ${name} [${risk}] ${category} — ${skill.description}`);
  }
  console.log();
}

async function runAgentMode(
  goal: string,
  adapter: LLMAdapter,
  rl: readline.Interface,
  abortController: AbortController,
): Promise<AgentLoopResult> {
  const skills = listActiveSkills();
  const systemPrompt = process.env.COPILOT_SYSTEM_PROMPT || undefined;

  const callbacks: AgentLoopCallbacks = {
    onProgress(message) {
      console.log(`  → ${message}`);
    },
    onToolCall(skillName, args) {
      const summary = argsToSummary(args);
      process.stdout.write(`  ⚡ ${skillName}(${summary})\n`);
    },
    onToolResult(skillName, result, isError) {
      const preview = result.slice(0, 100) + (result.length > 100 ? '…' : '');
      if (isError) {
        console.log(`  ✗ ${skillName}: ${preview}`);
      } else {
        console.log(`  ✓ ${skillName}: ${preview}`);
      }
    },
    onResponse(content, _iteration) {
      if (content.trim().startsWith('[SYSTEM]')) return;
      if (content.trim() === '') return;
      console.log(`\nAgent: ${content}\n`);
    },
    onCompaction(beforeTokens, afterTokens) {
      console.log(`  📦 Context compacted: ${beforeTokens} → ${afterTokens} tokens`);
    },
    async onRequestInput(question) {
      return new Promise((resolve) => {
        rl.question(`  ❓ ${question}\nYou: `, (answer) => {
          resolve(answer.trim());
        });
      });
    },
  };

  const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;

  return runAgentLoop({
    goal,
    adapter,
    skills,
    systemPrompt,
    maxIterations: Number(process.env.AGENT_MAX_ITERATIONS) || 25,
    timeoutMs,
    callbacks,
    abortSignal: abortController.signal,
  });
}

async function main() {
  let provider = resolveProvider();
  let apiKey = resolveApiKey(provider) ??
    process.env.COPILOT_PROVIDER_API_KEY ??
    process.env.COPILOT_API_KEY ??
    process.env.GITHUB_COPILOT_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.ANTHROPIC_API_KEY;

  if (!apiKey && !LOCAL_PROVIDERS.includes(provider)) {
    console.error(
      'Error: No API key found. Set one of: GITHUB_COPILOT_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY',
    );
    process.exit(1);
  }

  let model = resolveModel(provider);
  let adapter = buildAdapter(provider, model, apiKey);

  console.log(`CopHarness Agent CLI — provider: ${provider}, model: ${model}`);
  console.log('Commands: /agent, /skills, /model, /provider, /compact, /clear, /save, /load, /conversations, /delete, /autosave, /help');
  console.log('Type your message or use a command. Type "exit" to quit.\n');

  const messages: LLMMessage[] = [];
  const rawSystemPrompt = process.env.COPILOT_SYSTEM_PROMPT ?? '';
  if (rawSystemPrompt) {
    messages.push({ role: 'system', content: rawSystemPrompt });
  }

  // Conversation persistence state
  let autosaveEnabled = false;
  let currentConvId: string | undefined;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  let agentAbortController: AbortController | null = null;
  let sigintCount = 0;

  process.on('SIGINT', () => {
    if (agentAbortController) {
      sigintCount++;
      if (sigintCount === 1) {
        console.log('\n  Aborting agent task… (press Ctrl+C again to exit)');
        agentAbortController.abort();
      } else {
        console.log('\nGoodbye!');
        rl.close();
        process.exit(0);
      }
    } else {
      console.log('\nGoodbye!');
      rl.close();
      process.exit(0);
    }
  });

  const ask = () => {
    rl.question('You: ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        ask();
        return;
      }

      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        const userMessages = messages.filter((m) => m.role === 'user');
        if (userMessages.length > 0) {
          try {
            const savedId = saveConversation(messages, provider, model, currentConvId);
            console.log(`Conversation saved (id: ${savedId})`);
          } catch {
            // Non-fatal — don't block exit on save errors.
          }
        }
        console.log('Goodbye!');
        rl.close();
        if (adapter.destroy) await adapter.destroy();
        process.exit(0);
      }

      // Slash command dispatch
      if (trimmed.startsWith('/')) {
        const spaceIdx = trimmed.indexOf(' ');
        const command = spaceIdx === -1 ? trimmed.toLowerCase() : trimmed.slice(0, spaceIdx).toLowerCase();
        const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

        switch (command) {
          case '/help': {
            printHelp();
            break;
          }

          case '/skills': {
            printSkills();
            break;
          }

          case '/clear': {
            messages.length = 0;
            if (rawSystemPrompt) {
              messages.push({ role: 'system', content: rawSystemPrompt });
            }
            console.log('Conversation history cleared.\n');
            break;
          }

          case '/compact': {
            const beforeTokens = estimateConversationTokens(messages);
            try {
              const compacted = await compactMessages(messages, adapter);
              const afterTokens = estimateConversationTokens(compacted);
              messages.length = 0;
              messages.push(...compacted);
              console.log(`Context compacted: ${beforeTokens} → ${afterTokens} tokens\n`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`Compaction failed: ${msg}\n`);
            }
            break;
          }

          case '/model': {
            if (!rest) {
              console.log(`Current model: ${model}\nUsage: /model <name>\n`);
            } else {
              const oldAdapter = adapter;
              model = rest;
              adapter = buildAdapter(provider, model, apiKey);
              console.log(`Switched model to: ${model}\n`);
              if (oldAdapter.destroy) await oldAdapter.destroy();
            }
            break;
          }

          case '/provider': {
            if (!rest) {
              console.log(`Current provider: ${provider}\nUsage: /provider <name>\n`);
            } else {
              const validProviders: ProviderType[] = ['openai', 'anthropic', 'copilot', 'lmstudio', 'lemonade', 'antigravity'];
              const newProvider = rest.toLowerCase() as ProviderType;
              if (!validProviders.includes(newProvider)) {
                console.error(`Unknown provider: ${rest}. Valid: ${validProviders.join(', ')}\n`);
              } else {
                const oldAdapter = adapter;
                provider = newProvider;
                apiKey = resolveApiKey(provider) ??
                  process.env.COPILOT_PROVIDER_API_KEY ??
                  process.env.COPILOT_API_KEY;
                model = resolveModel(provider);
                adapter = buildAdapter(provider, model, apiKey);
                console.log(`Switched provider to: ${provider}, model: ${model}\n`);
                if (oldAdapter.destroy) await oldAdapter.destroy();
              }
            }
            break;
          }

          case '/agent': {
            if (!rest) {
              console.log('Usage: /agent <goal>\n');
              break;
            }
            console.log(`\nStarting agent loop for goal: "${rest}"\n`);
            agentAbortController = new AbortController();
            sigintCount = 0;
            try {
              const result = await runAgentMode(rest, adapter, rl, agentAbortController);
              if (result.completed && result.summary) {
                console.log(`\n✅ Agent completed in ${result.iterations} iterations (${(result.durationMs / 1000).toFixed(1)}s, ${result.toolCallCount} tool calls)`);
                console.log(`Summary: ${result.summary}\n`);
              } else if (!result.completed) {
                const reason = agentAbortController.signal.aborted ? 'aborted by user' : 'reached iteration limit';
                console.log(`\n⚠️  Agent stopped (${reason}) after ${result.iterations} iterations\n`);
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`Agent error: ${msg}\n`);
            } finally {
              agentAbortController = null;
              sigintCount = 0;
            }
            break;
          }

          case '/save': {
            const userMsgs = messages.filter((m) => m.role === 'user');
            if (userMsgs.length === 0) {
              console.log('Nothing to save — no messages in the current conversation.\n');
              break;
            }
            try {
              const title = rest || undefined;
              currentConvId = saveConversation(messages, provider, model, currentConvId, title);
              console.log(`Conversation saved (id: ${currentConvId})\n`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`Failed to save conversation: ${msg}\n`);
            }
            break;
          }

          case '/load': {
            if (!rest) {
              console.log('Usage: /load <id>\n');
              break;
            }
            try {
              const conv = loadConversation(rest);
              if (!conv) {
                console.log(`No conversation found with id: ${rest}\n`);
              } else {
                messages.length = 0;
                messages.push(...conv.messages);
                currentConvId = conv.id;
                console.log(`Loaded conversation "${conv.title}" (${conv.messageCount} messages)\n`);
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`Failed to load conversation: ${msg}\n`);
            }
            break;
          }

          case '/conversations':
          case '/list': {
            try {
              const convList = listConversations();
              if (convList.length === 0) {
                console.log('No saved conversations.\n');
              } else {
                console.log(`\nSaved conversations (${convList.length}):`);
                for (const entry of convList) {
                  const date = new Date(entry.updatedAt).toLocaleString();
                  console.log(`  ${entry.id}`);
                  console.log(`    Title:    ${entry.title}`);
                  console.log(`    Provider: ${entry.provider} / ${entry.model}`);
                  console.log(`    Messages: ${entry.messageCount}  |  Updated: ${date}`);
                  if (entry.preview) {
                    const preview = entry.preview.length > 80 ? entry.preview.slice(0, 80) + '…' : entry.preview;
                    console.log(`    Preview:  ${preview}`);
                  }
                }
                console.log();
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`Failed to list conversations: ${msg}\n`);
            }
            break;
          }

          case '/delete': {
            if (!rest) {
              console.log('Usage: /delete <id>\n');
              break;
            }
            try {
              const removed = deleteConversation(rest);
              if (removed) {
                console.log(`Conversation ${rest} deleted.\n`);
                if (currentConvId === rest) {
                  currentConvId = undefined;
                }
              } else {
                console.log(`No conversation found with id: ${rest}\n`);
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`Failed to delete conversation: ${msg}\n`);
            }
            break;
          }

          case '/autosave': {
            autosaveEnabled = !autosaveEnabled;
            console.log(`Auto-save ${autosaveEnabled ? 'enabled' : 'disabled'}.\n`);
            break;
          }

          default: {
            console.log(`Unknown command: ${command}. Type /help for a list of commands.\n`);
            break;
          }
        }

        ask();
        return;
      }

      // Normal chat
      messages.push({ role: 'user', content: trimmed });
      const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;

      try {
        process.stdout.write('Assistant: ');

        if (adapter.stream) {
          let fullContent = '';
          for await (const chunk of adapter.stream({
            messages,
            timeoutMs,
            skills: listActiveSkills(),
          })) {
            process.stdout.write(chunk);
            fullContent += chunk;
          }
          process.stdout.write('\n\n');
          messages.push({ role: 'assistant', content: fullContent });
        } else {
          const resp = await adapter.complete({
            messages,
            timeoutMs,
            skills: listActiveSkills(),
          });
          console.log(resp.content);
          console.log();
          messages.push({ role: 'assistant', content: resp.content });
        }
        // Auto-save after each successful exchange if enabled.
        if (autosaveEnabled) {
          try {
            currentConvId = saveConversation(messages, provider, model, currentConvId);
          } catch {
            // Non-fatal.
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\nError: ${msg}\n`);
        // Remove the failed user message so conversation stays consistent
        messages.pop();
      }

      ask();
    });
  };

  rl.on('close', () => {
    console.log('\nGoodbye!');
    process.exit(0);
  });

  ask();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
