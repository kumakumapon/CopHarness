'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowLeft, Send, Copy, Check, Sparkles, Play, RotateCcw } from 'lucide-react';

interface TemplateInfo {
  id: string;
  nameJa: string;
  descriptionJa: string;
  category: string;
  icon: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  hidden?: boolean;
}

const CATEGORY_COLORS: Record<string, string> = {
  '開発': '#6366f1',
  '文章': '#10b981',
  'コミュニケーション': '#f59e0b',
  '創造': '#ec4899',
  '分析': '#3b82f6',
  '応用': '#8b5cf6',
};

function cleanMessage(content: string): string {
  return content.replace(/<COLLECTED>[\s\S]*?<\/COLLECTED>/g, '').trim();
}

export default function PromptWizardPage() {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<string | null>(null);
  const [executingPrompt, setExecutingPrompt] = useState(false);
  const [copied, setCopied] = useState<'prompt' | 'result' | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/prompt-wizard')
      .then((r) => r.json())
      .then((d: { templates?: TemplateInfo[] }) => setTemplates(d.templates ?? []));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const startWizard = useCallback(async (template: TemplateInfo) => {
    setSelectedTemplate(template);
    setMessages([]);
    setGeneratedPrompt(null);
    setExecutionResult(null);
    setLoading(true);

    const trigger: ChatMessage = {
      role: 'user',
      content: 'プロンプト作成を開始してください',
      hidden: true,
    };
    try {
      const res = await fetch('/api/prompt-wizard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patternId: template.id,
          messages: [{ role: trigger.role, content: trigger.content }],
        }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      setMessages([
        trigger,
        { role: 'assistant', content: data.reply ?? data.error ?? 'エラーが発生しました' },
      ]);
    } catch {
      setMessages([
        trigger,
        { role: 'assistant', content: '接続エラーが発生しました。APIキーの設定を確認してください。' },
      ]);
    }
    setLoading(false);
  }, []);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading || !selectedTemplate) return;
    const userMsg: ChatMessage = { role: 'user', content: input.trim() };
    const newMessages: ChatMessage[] = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    const llmMessages = newMessages.map(({ role, content }) => ({ role, content }));
    try {
      const res = await fetch('/api/prompt-wizard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patternId: selectedTemplate.id, messages: llmMessages }),
      });
      const data = (await res.json()) as {
        reply?: string;
        error?: string;
        isComplete?: boolean;
        generatedPrompt?: string;
      };
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: data.reply ?? data.error ?? 'エラーが発生しました',
      };
      setMessages([...newMessages, assistantMsg]);
      if (data.isComplete && data.generatedPrompt) {
        setGeneratedPrompt(data.generatedPrompt);
      }
    } catch {
      setMessages([...newMessages, { role: 'assistant', content: '接続エラーが発生しました。' }]);
    }
    setLoading(false);
    textareaRef.current?.focus();
  }, [input, loading, selectedTemplate, messages]);

  const executePrompt = useCallback(async () => {
    if (!generatedPrompt || executingPrompt) return;
    setExecutingPrompt(true);
    setExecutionResult(null);
    try {
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: generatedPrompt }] }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      setExecutionResult(data.reply ?? data.error ?? '応答を取得できませんでした');
    } catch {
      setExecutionResult('実行エラーが発生しました。');
    }
    setExecutingPrompt(false);
  }, [generatedPrompt, executingPrompt]);

  const handleBack = useCallback(() => {
    setSelectedTemplate(null);
    setMessages([]);
    setGeneratedPrompt(null);
    setExecutionResult(null);
  }, []);

  const copyToClipboard = useCallback(async (text: string, key: 'prompt' | 'result') => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const displayMessages = messages.filter((m) => !m.hidden);

  // ─── Template selector ───────────────────────────────────────────────────
  if (!selectedTemplate) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--primary-bg)' }}>
        <div className="max-w-5xl mx-auto px-4 py-8">
          <div className="mb-8">
            <a
              href="/"
              className="inline-flex items-center gap-1.5 text-sm mb-4 hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ArrowLeft className="w-4 h-4" />
              トップへ戻る
            </a>
            <h1
              className="text-2xl font-bold mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              🪄 AIプロンプトウィザード
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              テンプレートを選択すると、AIが質問をしながらプロンプトを自動生成します
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => void startWizard(t)}
                className="text-left rounded-xl p-5 transition-all hover:shadow-lg hover:-translate-y-0.5 active:scale-95"
                style={{
                  background: 'var(--secondary-bg)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div className="text-3xl mb-3">{t.icon}</div>
                <div
                  className="font-semibold text-base mb-1"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {t.nameJa}
                </div>
                <div
                  className="text-xs mb-3"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {t.descriptionJa}
                </div>
                <span
                  className="inline-block px-2 py-0.5 rounded text-xs font-medium"
                  style={{
                    background: CATEGORY_COLORS[t.category]
                      ? `${CATEGORY_COLORS[t.category]}22`
                      : 'var(--accent-warm)',
                    color: CATEGORY_COLORS[t.category] ?? 'var(--text-secondary)',
                  }}
                >
                  {t.category}
                </span>
              </button>
            ))}
          </div>

          {templates.length === 0 && (
            <div
              className="text-center py-12 animate-pulse"
              style={{ color: 'var(--text-secondary)' }}
            >
              テンプレートを読み込み中...
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Chat + result ────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--primary-bg)' }}
    >
      {/* Top bar */}
      <div
        className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3 border-b"
        style={{ background: 'var(--secondary-bg)', borderColor: 'var(--border-color)' }}
      >
        <button
          onClick={handleBack}
          className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-xl">{selectedTemplate.icon}</span>
        <div>
          <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
            {selectedTemplate.nameJa}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {selectedTemplate.descriptionJa}
          </div>
        </div>
        <button
          onClick={handleBack}
          className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all hover:opacity-80"
          style={{
            background: 'var(--accent-warm)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-color)',
          }}
        >
          <RotateCcw className="w-3 h-3" />
          テンプレート変更
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Chat panel */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4" style={{ minHeight: '300px' }}>
            {displayMessages.map((msg, i) => {
              const isUser = msg.role === 'user';
              const displayContent = cleanMessage(msg.content);
              return (
                <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[80%] px-4 py-3 text-sm leading-relaxed"
                    style={{
                      background: isUser ? 'var(--accent-orange)' : 'var(--secondary-bg)',
                      color: 'var(--text-primary)',
                      border: isUser ? 'none' : '1px solid var(--border-color)',
                      borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    }}
                  >
                    <pre className="whitespace-pre-wrap font-sans">{displayContent}</pre>
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex justify-start">
                <div
                  className="px-4 py-3 text-sm"
                  style={{
                    background: 'var(--secondary-bg)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '18px 18px 18px 4px',
                  }}
                >
                  <span className="flex gap-1 items-center">
                    {[0, 150, 300].map((delay) => (
                      <span
                        key={delay}
                        className="w-2 h-2 rounded-full animate-bounce"
                        style={{
                          background: 'var(--text-secondary)',
                          animationDelay: `${delay}ms`,
                        }}
                      />
                    ))}
                  </span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input area – hidden once prompt is generated */}
          {!generatedPrompt && (
            <div
              className="border-t px-4 py-3"
              style={{ borderColor: 'var(--border-color)', background: 'var(--secondary-bg)' }}
            >
              <div className="flex gap-2 items-end">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="メッセージを入力（Enter で送信、Shift+Enter で改行）"
                  rows={2}
                  className="flex-1 resize-none rounded-xl px-3 py-2 text-sm outline-none"
                  style={{
                    background: 'var(--primary-bg)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                  }}
                />
                <button
                  onClick={() => void sendMessage()}
                  disabled={!input.trim() || loading}
                  className="p-2.5 rounded-xl transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
                  style={{ background: 'var(--accent-orange)', color: 'var(--text-primary)' }}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Generated prompt panel */}
        {generatedPrompt && (
          <div
            className="lg:w-96 border-t lg:border-t-0 lg:border-l flex flex-col"
            style={{ borderColor: 'var(--border-color)', background: 'var(--secondary-bg)' }}
          >
            <div
              className="px-4 py-3 border-b flex items-center gap-2"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <Sparkles className="w-4 h-4" style={{ color: 'var(--accent-orange)' }} />
              <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                生成されたプロンプト
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <pre
                className="whitespace-pre-wrap font-sans text-sm rounded-xl p-4 mb-4"
                style={{
                  background: 'var(--primary-bg)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                }}
              >
                {generatedPrompt}
              </pre>

              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => void copyToClipboard(generatedPrompt, 'prompt')}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90"
                  style={{
                    background: 'var(--accent-warm)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  {copied === 'prompt' ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  {copied === 'prompt' ? 'コピーしました' : 'コピー'}
                </button>
                <button
                  onClick={() => void executePrompt()}
                  disabled={executingPrompt}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'var(--accent-orange)', color: 'var(--text-primary)' }}
                >
                  {executingPrompt ? (
                    <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  {executingPrompt ? '実行中...' : 'LLM に実行'}
                </button>
              </div>

              {executionResult && (
                <div>
                  <div
                    className="flex items-center gap-2 mb-2"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <span className="text-xs font-semibold uppercase tracking-wider">
                      LLM の応答
                    </span>
                    <button
                      onClick={() => void copyToClipboard(executionResult, 'result')}
                      className="ml-auto p-1 rounded hover:opacity-70"
                    >
                      {copied === 'result' ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <pre
                    className="whitespace-pre-wrap font-sans text-sm rounded-xl p-4"
                    style={{
                      background: 'var(--primary-bg)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    {executionResult}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
