'use client';

import { useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Step {
  label: string;
  code?: string;
  note?: string;
}

interface Tutorial {
  id: number;
  title: string;
  difficulty: '初級' | '中級' | '上級';
  minutes: number;
  description: string;
  steps: Step[];
  expected: string;
  links?: { label: string; href: string }[];
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const TUTORIALS: Tutorial[] = [
  {
    id: 1,
    title: 'はじめての会話',
    difficulty: '初級',
    minutes: 5,
    description: 'CopHarness を最初に起動して LLM と対話するまでの最短経路です。',
    steps: [
      {
        label: '.env.example を .env.local にコピーする',
        code: 'cp .env.example .env.local',
      },
      {
        label: 'LLM プロバイダの API キーを 1 つ設定する',
        code: '# .env.local を開いて以下のいずれかを記入\nOPENAI_API_KEY=sk-...\n# または\nANTHROPIC_API_KEY=sk-ant-...',
        note: 'OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY など、いずれか 1 つで動作します。',
      },
      {
        label: '依存パッケージをインストールして CLI を起動する',
        code: 'npm install\nnpm run cli',
      },
      {
        label: '「今日の天気を教えて」と入力して応答を確認する',
        note: 'CLI のプロンプトに日本語でそのまま入力できます。',
      },
      {
        label: 'Web サーバーを起動してブラウザで開く',
        code: 'npm run dev\n# → http://localhost:3000 を開く',
      },
    ],
    expected: 'CLI と Web 両方で LLM からの自然言語応答が表示される。',
    links: [{ label: 'ダッシュボード', href: '/dashboard' }],
  },
  {
    id: 2,
    title: 'スキルを使った対話',
    difficulty: '初級',
    minutes: 10,
    description: '組み込みスキルを CLI から呼び出し、LLM が自律的にツールを選ぶ様子を観察します。',
    steps: [
      {
        label: 'ダッシュボードでスキル一覧を確認する',
        note: '/dashboard を開き、スキルセクションで有効なスキルをメモしておきます。',
      },
      {
        label: 'currentDateTime スキルを試す',
        code: '# CLI で以下のように入力\n現在の日時を教えて',
        note: 'LLM が自動で currentDateTime スキルを呼び出し、正確な日時を返します。',
      },
      {
        label: 'calculator スキルを試す',
        code: '1024 × 768 を計算して',
      },
      {
        label: 'webSearch スキルを試す',
        code: '最新の Node.js バージョンを調べて',
        note: 'インターネット検索が実行され、最新情報が返ります。',
      },
      {
        label: 'ダッシュボードのスキル実行履歴で結果を確認する',
        note: '/dashboard → スキル履歴セクションで各スキルの呼び出しログが見られます。',
      },
    ],
    expected: 'スキルが自動的に呼び出され、その結果が LLM の回答に組み込まれる。',
    links: [{ label: 'ダッシュボード', href: '/dashboard' }],
  },
  {
    id: 3,
    title: 'API を使ったプログラム連携',
    difficulty: '中級',
    minutes: 15,
    description: 'REST API と SSE ストリームを curl で叩き、外部アプリとの統合方法を学びます。',
    steps: [
      {
        label: 'Web サーバーを起動する',
        code: 'npm run dev',
      },
      {
        label: 'curl で単発リクエストを送る',
        code: `curl -X POST http://localhost:3000/api/copilot \\
  -H "Content-Type: application/json" \\
  -d '{"messages":[{"role":"user","content":"Hello!"}]}'`,
      },
      {
        label: 'ストリーミングリクエストを試す',
        code: `curl -X POST http://localhost:3000/api/copilot/stream \\
  -H "Content-Type: application/json" \\
  -d '{"messages":[{"role":"user","content":"自己紹介してください"}]}'`,
        note: 'SSE (Server-Sent Events) 形式でトークンが順次返ってきます。',
      },
      {
        label: 'スキルを指定してリクエストする',
        code: `curl -X POST http://localhost:3000/api/copilot \\
  -H "Content-Type: application/json" \\
  -d '{
  "messages":[{"role":"user","content":"今の時刻と 99×99 を教えて"}],
  "skills":["calculator","currentDateTime"]
}'`,
      },
      {
        label: 'レスポンスの構造を確認する',
        note: 'JSON レスポンスは { reply, toolCalls, usage } の形式です。usage にはトークン消費量が含まれます。',
      },
    ],
    expected: 'JSON レスポンスまたは SSE ストリームが返り、スキルの実行結果が reply に含まれる。',
    links: [{ label: 'ダッシュボード', href: '/dashboard' }],
  },
  {
    id: 4,
    title: 'スケジュール実行',
    difficulty: '中級',
    minutes: 15,
    description: 'cron 式でプロンプトを定期実行し、Discord / LINE に自動通知する仕組みを設定します。',
    steps: [
      {
        label: 'ダッシュボードのスケジューラーセクションを開く',
        note: '/dashboard を開き、「スケジューラー」セクションまでスクロールします。',
      },
      {
        label: '「スケジュール追加」で新規スケジュールを作成する',
        code: '名前: 朝の作業計画\ncron: 0 9 * * 1-5   # 平日 09:00\nプロンプト: 今日の作業候補を優先度順に3つ提案してください',
        note: '時刻フィールドに「09:00」と入力するか、cron 式を直接入力できます。',
      },
      {
        label: '「今すぐ実行」ボタンで即時テストする',
        note: 'スケジュール行の再生ボタンを押すと、cron 時刻に関係なく即時実行されます。',
      },
      {
        label: '実行ログで結果を確認する',
        note: 'ダッシュボードの実行ログセクションに結果テキストが表示されます。',
      },
      {
        label: 'Discord / LINE 通知先を設定する',
        code: '# .env.local に追記\nDISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...\nLINE_CHANNEL_ACCESS_TOKEN=...\nLINE_USER_ID=...',
        note: '通知先を設定すると、スケジュール実行後に結果が自動送信されます。',
      },
    ],
    expected: 'スケジュールが登録され、手動実行で結果がダッシュボードのログに記録される。',
    links: [{ label: 'ダッシュボード', href: '/dashboard' }],
  },
  {
    id: 5,
    title: 'エージェントオーケストレーション',
    difficulty: '上級',
    minutes: 20,
    description: 'Agent CLI を使い、複数スキルを自律的に連鎖させる DAG 実行を体験します。',
    steps: [
      {
        label: 'Agent CLI を起動する',
        code: 'npm run agent-cli',
      },
      {
        label: '複数ステップが必要なタスクを依頼する',
        code: 'Node.js の最新バージョンを調べて、changelog の要点を3つにまとめて',
        note: 'エージェントは webSearch → summarize の順でスキルを自律的に選択します。',
      },
      {
        label: 'スキルの連鎖呼び出しを観察する',
        note: 'ターミナルにスキル名・入力・出力が順次ログ表示されます。どのスキルがいつ呼ばれるか確認してください。',
      },
      {
        label: 'ダッシュボードでエージェントタスクの詳細を確認する',
        note: '/dashboard → タスク一覧で実行グラフと各ノードのステータスが見られます。',
      },
      {
        label: 'DAG (有向非巡回グラフ) 実行の仕組みを理解する',
        note: 'タスクは依存関係のある有向グラフとして表現されます。依存がないノードは並列実行され、全ノード完了後に結果が統合されます。',
      },
    ],
    expected: 'エージェントが自律的にスキルを選択・実行し、統合された最終回答が返る。',
    links: [{ label: 'ダッシュボード', href: '/dashboard' }],
  },
  {
    id: 6,
    title: '安全な本番運用',
    difficulty: '上級',
    minutes: 20,
    description: 'API 認証・Human-in-the-Loop・コスト可視化・監査ログを設定し、本番グレードの運用を整えます。',
    steps: [
      {
        label: 'API 認証キーを設定する',
        code: '# .env.local に追記\nCOPHARNESS_API_KEY=your-secret-key-here',
        note: '設定後は /api/copilot へのすべてのリクエストに Authorization: Bearer <key> が必要になります。',
      },
      {
        label: 'Human-in-the-Loop を有効化する',
        code: '# .env.local に追記\nHIL_ENABLED=true',
      },
      {
        label: '高リスクスキル実行時に承認画面が表示されることを確認する',
        note: 'HIL_ENABLED=true の状態で、リスクレベルが HIGH 以上のスキルを呼び出すと、実行前にダッシュボードの承認待ち画面が表示されます。',
      },
      {
        label: '承認待ち画面で承認・却下を操作する',
        note: '/dashboard → 承認待ち セクションで、実行内容を確認してから承認または却下できます。却下した場合、スキルは実行されずエラーが返ります。',
      },
      {
        label: 'コスト・トークン使用量を確認する',
        note: 'ダッシュボードの使用量セクションに、プロバイダ別のトークン数と推定コストが表示されます。',
      },
      {
        label: '監査ログを確認する',
        code: '# ログファイルのデフォルトパス\ncat logs/audit.jsonl | jq .',
        note: '各リクエストの入出力・スキル呼び出し・承認状態がすべて JSONL 形式で記録されます。',
      },
    ],
    expected: '高リスク操作に承認ゲートがかかり、コストと操作履歴がダッシュボードで可視化される。',
    links: [{ label: 'ダッシュボード', href: '/dashboard' }],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIFFICULTY_STYLE: Record<Tutorial['difficulty'], React.CSSProperties> = {
  初級: {
    background: '#d4edda',
    color: '#276749',
    border: '1px solid #a8d5ba',
  },
  中級: {
    background: 'var(--accent-peachy)',
    color: '#8a4a1a',
    border: '1px solid var(--accent-orange)',
  },
  上級: {
    background: '#fde8e8',
    color: '#8b2020',
    border: '1px solid #e8a0a0',
  },
};

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border-color)',
  borderRadius: '18px',
  background: 'rgba(255, 255, 255, 0.72)',
  boxShadow: '0 16px 40px var(--shadow-light)',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProgressBar({ checked, total }: { checked: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((checked / total) * 100);
  return (
    <div style={{ marginBottom: '16px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '6px',
          fontSize: '0.8rem',
          color: 'var(--text-secondary)',
        }}
      >
        <span>進捗</span>
        <span>
          {checked} / {total} ステップ完了 ({pct}%)
        </span>
      </div>
      <div
        style={{
          height: '7px',
          borderRadius: '99px',
          background: 'var(--accent-warm)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            borderRadius: '99px',
            background:
              pct === 100
                ? 'linear-gradient(90deg, #a8d5ba, #68b88e)'
                : 'linear-gradient(90deg, var(--accent-orange), #e09070)',
            transition: 'width 0.35s ease',
          }}
        />
      </div>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre
      style={{
        background: '#2d2a2e',
        color: '#f8f8f2',
        borderRadius: '12px',
        padding: '16px',
        overflow: 'auto',
        fontSize: '0.82rem',
        lineHeight: 1.65,
        margin: '10px 0 2px',
        fontFamily: '"SF Mono", "Fira Mono", "Consolas", monospace',
        whiteSpace: 'pre',
      }}
    >
      <code>{code}</code>
    </pre>
  );
}

function ExpectedBlock({ text }: { text: string }) {
  return (
    <div
      style={{
        marginTop: '16px',
        padding: '14px 16px',
        borderRadius: '12px',
        background: 'rgba(168, 213, 186, 0.18)',
        border: '1px solid #a8d5ba',
        fontSize: '0.88rem',
        color: '#2a5c3f',
        lineHeight: 1.65,
      }}
    >
      <span style={{ fontWeight: 700, display: 'block', marginBottom: '4px' }}>期待される結果</span>
      {text}
    </div>
  );
}

interface TutorialCardProps {
  tutorial: Tutorial;
}

function TutorialCard({ tutorial }: TutorialCardProps) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<boolean[]>(() =>
    tutorial.steps.map(() => false)
  );

  const checkedCount = checked.filter(Boolean).length;

  function toggleStep(i: number) {
    setChecked((prev) => {
      const next = [...prev];
      next[i] = !next[i];
      return next;
    });
  }

  const diffStyle = DIFFICULTY_STYLE[tutorial.difficulty];

  return (
    <article style={{ ...cardStyle, overflow: 'hidden' }}>
      {/* Card header — always visible */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: 'grid',
          gridTemplateColumns: '48px 1fr auto',
          alignItems: 'start',
          gap: '14px',
          width: '100%',
          padding: '22px 24px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'inherit',
        }}
      >
        {/* Number badge */}
        <span
          style={{
            display: 'grid',
            placeItems: 'center',
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            background: 'var(--accent-peachy)',
            fontWeight: 800,
            fontSize: '1.05rem',
            color: 'var(--text-primary)',
            flexShrink: 0,
          }}
        >
          {String(tutorial.id).padStart(2, '0')}
        </span>

        {/* Title + meta */}
        <div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '4px',
            }}
          >
            <span style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
              {tutorial.title}
            </span>
            <span
              style={{
                ...diffStyle,
                padding: '2px 10px',
                borderRadius: '99px',
                fontSize: '0.74rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
              }}
            >
              {tutorial.difficulty}
            </span>
            <span
              style={{
                padding: '2px 10px',
                borderRadius: '99px',
                background: 'var(--secondary-bg)',
                border: '1px solid var(--border-color)',
                fontSize: '0.74rem',
                color: 'var(--text-secondary)',
              }}
            >
              約 {tutorial.minutes} 分
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.6 }}>
            {tutorial.description}
          </p>
          {/* Mini progress when collapsed */}
          {!open && checkedCount > 0 && (
            <p
              style={{
                marginTop: '6px',
                fontSize: '0.78rem',
                color: checkedCount === tutorial.steps.length ? '#276749' : 'var(--text-secondary)',
              }}
            >
              {checkedCount === tutorial.steps.length
                ? '完了'
                : `${checkedCount}/${tutorial.steps.length} ステップ完了`}
            </p>
          )}
        </div>

        {/* Chevron */}
        <span
          style={{
            display: 'inline-block',
            fontSize: '1.1rem',
            color: 'var(--text-secondary)',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.22s ease',
            marginTop: '2px',
          }}
        >
          ›
        </span>
      </button>

      {/* Expandable body */}
      {open && (
        <div style={{ padding: '0 24px 24px' }}>
          <ProgressBar checked={checkedCount} total={tutorial.steps.length} />

          <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '12px' }}>
            {tutorial.steps.map((step, i) => (
              <li
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '28px 1fr',
                  gap: '12px',
                  padding: '14px 16px',
                  borderRadius: '14px',
                  background: checked[i]
                    ? 'rgba(168, 213, 186, 0.15)'
                    : 'var(--secondary-bg)',
                  border: checked[i]
                    ? '1px solid rgba(168, 213, 186, 0.6)'
                    : '1px solid transparent',
                  transition: 'background 0.2s, border 0.2s',
                }}
              >
                {/* Checkbox */}
                <button
                  onClick={() => toggleStep(i)}
                  aria-label={checked[i] ? 'ステップを未完了にする' : 'ステップを完了にする'}
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '6px',
                    border: checked[i]
                      ? '2px solid #68b88e'
                      : '2px solid var(--accent-orange)',
                    background: checked[i] ? '#68b88e' : 'transparent',
                    cursor: 'pointer',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                    marginTop: '1px',
                    transition: 'background 0.18s, border 0.18s',
                    padding: 0,
                  }}
                >
                  {checked[i] && (
                    <svg
                      viewBox="0 0 12 10"
                      width="12"
                      height="10"
                      fill="none"
                      stroke="#fff"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="1,5 4.5,8.5 11,1" />
                    </svg>
                  )}
                </button>

                {/* Step content */}
                <div>
                  <p
                    style={{
                      margin: 0,
                      fontWeight: 600,
                      fontSize: '0.92rem',
                      color: checked[i] ? '#2a5c3f' : 'var(--text-primary)',
                      textDecoration: checked[i] ? 'line-through' : 'none',
                      lineHeight: 1.5,
                    }}
                  >
                    {i + 1}. {step.label}
                  </p>
                  {step.note && (
                    <p
                      style={{
                        margin: '6px 0 0',
                        fontSize: '0.82rem',
                        color: 'var(--text-secondary)',
                        lineHeight: 1.6,
                      }}
                    >
                      {step.note}
                    </p>
                  )}
                  {step.code && <CodeBlock code={step.code} />}
                </div>
              </li>
            ))}
          </ol>

          <ExpectedBlock text={tutorial.expected} />

          {tutorial.links && tutorial.links.length > 0 && (
            <div
              style={{
                marginTop: '14px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              {tutorial.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  style={{
                    padding: '6px 16px',
                    borderRadius: '99px',
                    background: 'var(--accent-orange)',
                    color: 'var(--text-primary)',
                    textDecoration: 'none',
                    fontSize: '0.83rem',
                    fontWeight: 700,
                    border: '1px solid rgba(90,74,66,0.1)',
                  }}
                >
                  {link.label} →
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TutorialsPage() {
  return (
    <main
      style={{
        padding: '40px 20px 64px',
        fontFamily: 'inherit',
        maxWidth: '1100px',
        margin: '0 auto',
      }}
    >
      {/* Back link */}
      <a
        href="/"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          color: 'var(--text-secondary)',
          textDecoration: 'none',
          fontSize: '0.85rem',
          fontWeight: 600,
          marginBottom: '24px',
        }}
      >
        ← ホームへ戻る
      </a>

      {/* Page header */}
      <section
        style={{
          ...cardStyle,
          padding: '32px',
          marginBottom: '28px',
          background:
            'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(249,217,197,0.55))',
        }}
      >
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: '0.8rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            marginBottom: '8px',
          }}
        >
          Step-by-step Learning Guide
        </p>
        <h1
          style={{
            fontSize: 'clamp(1.8rem, 4vw, 2.8rem)',
            fontWeight: 800,
            marginBottom: '12px',
            color: 'var(--text-primary)',
          }}
        >
          チュートリアル
        </h1>
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: '1rem',
            lineHeight: 1.7,
            maxWidth: '640px',
          }}
        >
          CopHarness の主要機能をステップごとに体験できるガイドです。初級から上級まで、
          自分のペースで進めてください。各ステップはチェックボックスで進捗を記録できます。
        </p>

        {/* Difficulty legend */}
        <div
          style={{
            marginTop: '20px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          {(Object.keys(DIFFICULTY_STYLE) as Tutorial['difficulty'][]).map((d) => (
            <span
              key={d}
              style={{
                ...DIFFICULTY_STYLE[d],
                padding: '4px 14px',
                borderRadius: '99px',
                fontSize: '0.8rem',
                fontWeight: 700,
              }}
            >
              {d}
            </span>
          ))}
          <span
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.8rem',
              alignSelf: 'center',
              marginLeft: '4px',
            }}
          >
            — 難易度の目安
          </span>
        </div>
      </section>

      {/* Tutorial grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
          gap: '20px',
        }}
      >
        {TUTORIALS.map((tutorial) => (
          <TutorialCard key={tutorial.id} tutorial={tutorial} />
        ))}
      </div>

      {/* Footer hint */}
      <p
        style={{
          marginTop: '36px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
          fontSize: '0.85rem',
          lineHeight: 1.7,
        }}
      >
        困ったときは{' '}
        <a
          href="/dashboard"
          style={{ color: 'var(--text-primary)', fontWeight: 700 }}
        >
          ダッシュボード
        </a>{' '}
        の実行ログやスキル一覧を確認してください。
        チェック状態はページをリロードするとリセットされます。
      </p>
    </main>
  );
}
