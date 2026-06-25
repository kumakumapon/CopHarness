'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolCall {
  name: string;
  result?: string;
}

interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  toolCalls?: ToolCall[];
  usage?: Usage;
  streaming?: boolean;
}

interface Template {
  label: string;
  description: string;
  prompt: string;
  skills?: string[];
}

interface TemplateCategory {
  category: string;
  items: Template[];
}

// ---------------------------------------------------------------------------
// Template data
// ---------------------------------------------------------------------------

const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  {
    category: '基本操作 (Basic)',
    items: [
      {
        label: '自己紹介してください',
        description: 'LLM の応答を確認する最初のテスト',
        prompt: '自己紹介してください',
      },
      {
        label: 'このメッセージを英語に翻訳してください',
        description: '翻訳タスクの基本',
        prompt: 'このメッセージを英語に翻訳してください: こんにちは、世界',
      },
      {
        label: '以下の文章を3行で要約してください',
        description: '要約タスクの基本',
        prompt: '以下の文章を3行で要約してください: [ここにテキストを貼り付け]',
      },
    ],
  },
  {
    category: 'スキル活用 (Skills)',
    items: [
      {
        label: '現在の日時を教えてください',
        description: 'currentDateTime スキルの動作確認',
        prompt: '現在の日時を教えてください',
        skills: ['currentDateTime'],
      },
      {
        label: '1234 × 5678 を計算してください',
        description: 'calculator スキルの動作確認',
        prompt: '1234 × 5678 を計算してください',
        skills: ['calculator'],
      },
      {
        label: '最新の TypeScript の機能について調べてください',
        description: 'webSearch スキルで外部情報を取得',
        prompt: '最新の TypeScript の機能について調べてください',
        skills: ['webSearch'],
      },
      {
        label: 'https://example.com の内容を取得して要約',
        description: 'fetchUrl スキルで Web ページを読み取り',
        prompt: 'https://example.com の内容を取得して要約してください',
        skills: ['fetchUrl'],
      },
    ],
  },
  {
    category: '業務活用 (Business)',
    items: [
      {
        label: 'リリース前チェックリスト生成',
        description: 'リリース前チェックリスト生成',
        prompt:
          '今日のリリース準備で確認すべきリスクを優先度順に5件以内で整理してください',
      },
      {
        label: 'エラーログ分析',
        description: 'エラー分析支援',
        prompt:
          '以下のエラーログを分析して、原因と対策を提案してください: [ログを貼り付け]',
      },
      {
        label: '会議アジェンダ作成',
        description: '会議準備の自動化',
        prompt:
          '30分の会議アジェンダを作成してください。テーマ: [テーマ]',
      },
    ],
  },
  {
    category: '高度な使い方 (Advanced)',
    items: [
      {
        label: 'JSON → CSV 変換',
        description: 'データ変換タスク',
        prompt:
          '以下のJSONデータをCSV形式に変換してください: [JSON]',
      },
      {
        label: 'コードレビュー',
        description: 'コードレビュー支援',
        prompt:
          '以下のコードをレビューして改善点を指摘してください: [コード]',
      },
    ],
  },
];

const ALL_SKILLS = ['currentDateTime', 'calculator', 'webSearch', 'fetchUrl', 'memory', 'notes'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function getPromptTokens(usage: Usage | undefined): number {
  return usage?.promptTokens ?? usage?.prompt_tokens ?? 0;
}

function getCompletionTokens(usage: Usage | undefined): number {
  return usage?.completionTokens ?? usage?.completion_tokens ?? 0;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TypingIndicator() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '12px 16px',
        background: 'white',
        borderRadius: '18px 18px 18px 4px',
        boxShadow: '0 2px 8px var(--shadow-light)',
        width: 'fit-content',
      }}
    >
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </div>
  );
}

function ToolCallBadge({ call }: { call: ToolCall }) {
  const preview = call.result ? call.result.slice(0, 60) + (call.result.length > 60 ? '…' : '') : '';
  return (
    <span
      title={call.result}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 10px',
        borderRadius: '999px',
        background: 'var(--secondary-bg)',
        border: '1px solid var(--border-color)',
        fontSize: '0.75rem',
        color: 'var(--text-secondary)',
        cursor: call.result ? 'help' : 'default',
      }}
    >
      <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{call.name}</span>
      {preview && <span>{preview}</span>}
    </span>
  );
}

function MessageRow({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  const isError = msg.role === 'error';

  return (
    <div
      className="message-row"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        gap: '6px',
      }}
    >
      {/* bubble */}
      <div
        className="message-bubble"
        style={{
          background: isError
            ? 'rgba(239,68,68,0.08)'
            : isUser
              ? 'var(--accent-orange)'
              : 'white',
          borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          border: isError
            ? '1px solid rgba(239,68,68,0.3)'
            : '1px solid var(--border-color)',
          boxShadow: '0 2px 8px var(--shadow-light)',
          color: isError ? '#b91c1c' : 'var(--text-primary)',
          maxWidth: undefined, // let .message-bubble CSS handle it
        }}
      >
        {msg.streaming && msg.content === '' ? (
          <TypingIndicator />
        ) : (
          <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
        )}
      </div>

      {/* streaming dots when content is accumulating */}
      {msg.streaming && msg.content !== '' && (
        <div style={{ display: 'flex', gap: '3px', padding: '0 4px' }}>
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      )}

      {/* tool call badges */}
      {msg.toolCalls && msg.toolCalls.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {msg.toolCalls.map((tc, i) => (
            <ToolCallBadge key={i} call={tc} />
          ))}
        </div>
      )}

      {/* token usage */}
      {msg.usage && (
        <span
          style={{
            fontSize: '0.72rem',
            color: 'var(--text-secondary)',
            padding: '2px 8px',
            background: 'var(--secondary-bg)',
            borderRadius: '999px',
          }}
        >
          トークン: prompt {getPromptTokens(msg.usage)} / completion {getCompletionTokens(msg.usage)}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PlaygroundPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [useStreaming, setUseStreaming] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-grow textarea
  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 24;
    const maxHeight = lineHeight * 4 + 24; // 4 rows + padding
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
  }, []);

  useEffect(() => {
    autoGrow();
  }, [inputValue, autoGrow]);

  // -------------------------------------------------------------------------
  // Template selection
  // -------------------------------------------------------------------------
  const handleSelectTemplate = useCallback((template: Template) => {
    setSelectedTemplate(template.label);
    setInputValue(template.prompt);
    if (template.skills) {
      setSelectedSkills(new Set(template.skills));
    }
    textareaRef.current?.focus();
  }, []);

  // -------------------------------------------------------------------------
  // Skills toggle
  // -------------------------------------------------------------------------
  const toggleSkill = useCallback((skill: string) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) {
        next.delete(skill);
      } else {
        next.add(skill);
      }
      return next;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Send message
  // -------------------------------------------------------------------------
  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;

    // Build conversation history
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const userMsg: Message = { id: uid(), role: 'user', content: text };
    const assistantId = uid();
    const assistantMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInputValue('');
    setIsLoading(true);

    const requestMessages = [...history, { role: 'user' as const, content: text }];
    const skills = Array.from(selectedSkills);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      if (useStreaming) {
        // ---- SSE streaming ----
        const response = await fetch('/api/copilot/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: requestMessages, skills, subject: 'playground' }),
          signal: abort.signal,
        });

        if (!response.ok) {
          let errMsg = `HTTP ${response.status}`;
          try {
            const errData = await response.json();
            errMsg = errData.error ?? errData.message ?? errMsg;
          } catch {
            // ignore parse error
          }
          if (response.status === 401 || response.status === 403) {
            errMsg = 'API キーが設定されていません。.env.local にプロバイダの API キーを設定してください。';
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: errMsg, role: 'error' as const, streaming: false }
                : m,
            ),
          );
          return;
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';
        let finalUsage: Usage | undefined;
        let finalToolCalls: ToolCall[] | undefined;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE lines
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const json = line.slice(6).trim();
            if (!json || json === '[DONE]') continue;
            try {
              const parsed = JSON.parse(json);
              if (parsed.token !== undefined) {
                accumulated += parsed.token;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: accumulated } : m,
                  ),
                );
              }
              if (parsed.done) {
                if (parsed.reply !== undefined) {
                  accumulated = parsed.reply;
                }
                finalUsage = parsed.usage;
                finalToolCalls = parsed.toolCalls;
              }
            } catch {
              // skip malformed SSE lines
            }
          }
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: accumulated,
                  streaming: false,
                  usage: finalUsage,
                  toolCalls: finalToolCalls,
                }
              : m,
          ),
        );
      } else {
        // ---- Non-streaming ----
        const response = await fetch('/api/copilot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: requestMessages, skills, subject: 'playground' }),
          signal: abort.signal,
        });

        if (!response.ok) {
          let errMsg = `HTTP ${response.status}`;
          try {
            const errData = await response.json();
            errMsg = errData.error ?? errData.message ?? errMsg;
          } catch {
            // ignore
          }
          if (response.status === 401 || response.status === 403) {
            errMsg = 'API キーが設定されていません。.env.local にプロバイダの API キーを設定してください。';
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: errMsg, role: 'error' as const, streaming: false }
                : m,
            ),
          );
          return;
        }

        const data = await response.json();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: data.reply ?? '',
                  streaming: false,
                  usage: data.usage,
                  toolCalls: data.toolCalls,
                }
              : m,
          ),
        );
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content || '(中断しました)', streaming: false }
              : m,
          ),
        );
        return;
      }
      const msg = err instanceof Error ? err.message : '不明なエラーが発生しました';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: msg, role: 'error' as const, streaming: false }
            : m,
        ),
      );
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [inputValue, isLoading, messages, selectedSkills, useStreaming]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleClear = useCallback(() => {
    setMessages([]);
    setSelectedTemplate(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const cardStyle: React.CSSProperties = {
    border: '1px solid var(--border-color)',
    borderRadius: '18px',
    background: 'rgba(255,255,255,0.72)',
    boxShadow: '0 16px 40px var(--shadow-light)',
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '24px 16px 40px',
        fontFamily: 'inherit',
        maxWidth: '1200px',
        margin: '0 auto',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          marginBottom: '24px',
          flexWrap: 'wrap',
        }}
      >
        <Link
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            color: 'var(--text-secondary)',
            textDecoration: 'none',
            fontSize: '0.88rem',
            padding: '6px 14px',
            borderRadius: '999px',
            border: '1px solid var(--border-color)',
            background: 'rgba(255,255,255,0.7)',
          }}
        >
          &#8592; ホームへ
        </Link>
        <div>
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 800,
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            Playground
          </h1>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.84rem',
              margin: '2px 0 0',
            }}
          >
            プロンプトを試してスキルと LLM の応答を確認できます
          </p>
        </div>
      </div>

      {/* 2-column layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)',
          gap: '20px',
          alignItems: 'start',
        }}
        className="playground-grid"
      >
        {/* ================================================================ */}
        {/* LEFT PANEL                                                       */}
        {/* ================================================================ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Template selector */}
          <div style={{ ...cardStyle, padding: '20px' }}>
            <p
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
                marginBottom: '14px',
              }}
            >
              テンプレート
            </p>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                maxHeight: '460px',
                overflowY: 'auto',
                paddingRight: '4px',
              }}
              className="messages-container"
            >
              {TEMPLATE_CATEGORIES.map((cat) => (
                <div key={cat.category}>
                  <p
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--text-secondary)',
                      marginBottom: '8px',
                    }}
                  >
                    {cat.category}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {cat.items.map((tpl) => {
                      const isSelected = selectedTemplate === tpl.label;
                      return (
                        <button
                          key={tpl.label}
                          onClick={() => handleSelectTemplate(tpl)}
                          style={{
                            textAlign: 'left',
                            padding: '10px 12px',
                            borderRadius: '12px',
                            border: isSelected
                              ? '2px solid var(--accent-orange)'
                              : '1px solid var(--border-color)',
                            background: isSelected
                              ? 'var(--accent-peachy)'
                              : 'rgba(255,255,255,0.6)',
                            cursor: 'pointer',
                            transition: 'border-color 0.15s, background 0.15s',
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: '0.85rem',
                              color: 'var(--text-primary)',
                              marginBottom: '3px',
                            }}
                          >
                            {tpl.label}
                          </div>
                          <div
                            style={{
                              fontSize: '0.75rem',
                              color: 'var(--text-secondary)',
                              lineHeight: 1.4,
                            }}
                          >
                            {tpl.description}
                          </div>
                          {tpl.skills && tpl.skills.length > 0 && (
                            <div
                              style={{
                                marginTop: '6px',
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '4px',
                              }}
                            >
                              {tpl.skills.map((s) => (
                                <span
                                  key={s}
                                  style={{
                                    fontSize: '0.68rem',
                                    padding: '2px 7px',
                                    borderRadius: '999px',
                                    background: 'var(--accent-warm)',
                                    color: 'var(--text-primary)',
                                    fontWeight: 600,
                                  }}
                                >
                                  {s}
                                </span>
                              ))}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Settings card */}
          <div style={{ ...cardStyle, padding: '20px' }}>
            <p
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
                marginBottom: '14px',
              }}
            >
              設定
            </p>

            {/* Streaming toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px',
                padding: '12px 14px',
                borderRadius: '12px',
                background: 'var(--secondary-bg)',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>ストリーミング</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {useStreaming ? 'SSE リアルタイム出力' : 'レスポンス一括受信'}
                </div>
              </div>
              <button
                onClick={() => setUseStreaming((v) => !v)}
                aria-checked={useStreaming}
                role="switch"
                style={{
                  width: '44px',
                  height: '24px',
                  borderRadius: '999px',
                  border: 'none',
                  background: useStreaming ? 'var(--accent-orange)' : 'var(--accent-warm)',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'background 0.2s',
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: '3px',
                    left: useStreaming ? '22px' : '3px',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: 'white',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                    transition: 'left 0.2s',
                  }}
                />
              </button>
            </div>

            {/* Skills checkboxes */}
            <div>
              <p
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: '10px',
                }}
              >
                スキル
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {ALL_SKILLS.map((skill) => {
                  const checked = selectedSkills.has(skill);
                  return (
                    <label
                      key={skill}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px 12px',
                        borderRadius: '10px',
                        background: checked ? 'var(--accent-peachy)' : 'rgba(255,255,255,0.5)',
                        border: checked
                          ? '1px solid var(--accent-orange)'
                          : '1px solid var(--border-color)',
                        cursor: 'pointer',
                        transition: 'background 0.15s, border-color 0.15s',
                        fontSize: '0.85rem',
                        fontWeight: checked ? 600 : 400,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSkill(skill)}
                        style={{ accentColor: 'var(--accent-orange)', width: '15px', height: '15px' }}
                      />
                      {skill}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ================================================================ */}
        {/* RIGHT PANEL                                                      */}
        {/* ================================================================ */}
        <div
          style={{
            ...cardStyle,
            display: 'flex',
            flexDirection: 'column',
            minHeight: '600px',
            maxHeight: '85vh',
            overflow: 'hidden',
          }}
        >
          {/* Chat header */}
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: isLoading ? '#f59e0b' : '#22c55e',
                  boxShadow: isLoading
                    ? '0 0 0 3px rgba(245,158,11,0.2)'
                    : '0 0 0 3px rgba(34,197,94,0.2)',
                }}
              />
              <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                {isLoading ? '応答中...' : 'アシスタント'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {/* Mode badge */}
              <span
                style={{
                  fontSize: '0.72rem',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  background: useStreaming ? 'var(--accent-peachy)' : 'var(--secondary-bg)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
                }}
              >
                {useStreaming ? 'SSE' : '非同期'}
              </span>
              {/* Clear button */}
              <button
                onClick={handleClear}
                disabled={isLoading}
                title="会話をクリア"
                style={{
                  padding: '5px 12px',
                  borderRadius: '999px',
                  border: '1px solid var(--border-color)',
                  background: 'rgba(255,255,255,0.7)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                クリア
              </button>
            </div>
          </div>

          {/* Messages area */}
          <div
            className="messages-container"
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            {messages.length === 0 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  gap: '12px',
                  color: 'var(--text-secondary)',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '50%',
                    background: 'var(--secondary-bg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.6rem',
                  }}
                >
                  &#128172;
                </div>
                <div>
                  <p style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>
                    プレイグラウンドへようこそ
                  </p>
                  <p style={{ fontSize: '0.85rem', lineHeight: 1.6 }}>
                    左のテンプレートを選ぶか、<br />
                    直接プロンプトを入力して送信してください
                  </p>
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <MessageRow key={msg.id} msg={msg} />
            ))}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div
            style={{
              padding: '14px 16px',
              borderTop: '1px solid var(--border-color)',
              background: 'rgba(250,246,241,0.8)',
              borderRadius: '0 0 18px 18px',
              flexShrink: 0,
            }}
          >
            {/* Active skills pills */}
            {selectedSkills.size > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '5px',
                  marginBottom: '10px',
                }}
              >
                {Array.from(selectedSkills).map((s) => (
                  <span
                    key={s}
                    style={{
                      fontSize: '0.72rem',
                      padding: '2px 9px',
                      borderRadius: '999px',
                      background: 'var(--accent-warm)',
                      color: 'var(--text-primary)',
                      fontWeight: 600,
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="プロンプトを入力... (Shift+Enter で改行)"
                rows={1}
                disabled={isLoading}
                className="input-field"
                style={{
                  flex: 1,
                  resize: 'none',
                  border: '1px solid var(--border-color)',
                  borderRadius: '14px',
                  padding: '11px 14px',
                  fontFamily: 'inherit',
                  fontSize: '0.92rem',
                  background: 'white',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  lineHeight: '1.5',
                  overflowY: 'hidden',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
              />

              {isLoading ? (
                <button
                  onClick={handleCancel}
                  className="cancel-button"
                  style={{
                    flexShrink: 0,
                    padding: '11px 18px',
                    borderRadius: '14px',
                    border: 'none',
                    background: '#fca5a5',
                    color: '#7f1d1d',
                    fontWeight: 700,
                    fontSize: '0.88rem',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  中断
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                  className="send-button"
                  style={{
                    flexShrink: 0,
                    padding: '11px 18px',
                    borderRadius: '14px',
                    border: 'none',
                    background: inputValue.trim() ? 'var(--accent-orange)' : 'var(--accent-warm)',
                    color: inputValue.trim() ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: 700,
                    fontSize: '0.88rem',
                    cursor: inputValue.trim() ? 'pointer' : 'default',
                    transition: 'background 0.15s, transform 0.1s, box-shadow 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  送信 &#8679;
                </button>
              )}
            </div>
            <p
              style={{
                fontSize: '0.7rem',
                color: 'var(--text-secondary)',
                marginTop: '6px',
                paddingLeft: '2px',
              }}
            >
              Enter で送信 &nbsp;·&nbsp; Shift+Enter で改行
            </p>
          </div>
        </div>
      </div>

      {/* Responsive style override — stack panels on narrow viewports */}
      <style>{`
        @media (max-width: 767px) {
          .playground-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}
