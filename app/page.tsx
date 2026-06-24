const learningSteps = [
  {
    step: '01',
    title: 'まずはダッシュボードで状態確認',
    body: 'LLM プロバイダー、Discord / LINE 連携、スキルの有効状態を見て、実行できる入口を把握します。',
  },
  {
    step: '02',
    title: '小さな定期タスクを作る',
    body: '毎朝の要約やログ確認など、失敗しても影響が小さい作業からスケジューラーに登録します。',
  },
  {
    step: '03',
    title: '結果をログで振り返る',
    body: '成功・失敗・中断の履歴を見ながら、プロンプトの粒度や実行頻度を調整します。',
  },
];

const scenarios = [
  'チームの朝会前に、前日ログと未完了タスクを要約する',
  'Discord で依頼された調査を、実行ログ付きでダッシュボードから追跡する',
  '評価用プロンプトを CLI で試し、安定したらスケジュール化する',
];

const promptExamples = [
  '今日のリリース準備で確認すべきリスクを、優先度順に 5 件以内で整理して。',
  '直近の実行ログから失敗が多いジョブ名、原因候補、次の確認手順を表にして。',
  'この依頼を 30 分で終えるために、必要な入力情報と作業手順をチェックリスト化して。',
];

const safetyTips = [
  '本番データを扱う前に、読み取り専用・短時間・低頻度のタスクで試す',
  'スキル実行のリスクレベルと承認ポリシーを確認してから有効化する',
  '長時間実行や外部通知を伴うタスクは、停止方法と通知先を先に決める',
];

const cardStyle = {
  border: '1px solid var(--border-color)',
  borderRadius: '18px',
  background: 'rgba(255, 255, 255, 0.72)',
  boxShadow: '0 16px 40px var(--shadow-light)',
} as const;

export default function Home() {
  return (
    <main
      style={{
        padding: '40px 20px 56px',
        fontFamily: 'inherit',
        maxWidth: '1040px',
        margin: '0 auto',
      }}
    >
      <section
        style={{
          ...cardStyle,
          padding: '32px',
          background:
            'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(249,217,197,0.5))',
        }}
      >
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: '0.82rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            marginBottom: '10px',
            textTransform: 'uppercase',
          }}
        >
          LLM Harness Learning Hub
        </p>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.4rem)', fontWeight: 800, marginBottom: '12px' }}>
          CopHarness
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', marginBottom: '24px' }}>
          CLI / Discord / ダッシュボードを組み合わせて、LLM タスクを安全に試し、観察し、運用へ育てるためのハーネスです。
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
          <a
            href="/dashboard"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '14px 18px',
              borderRadius: '999px',
              background: 'var(--accent-orange)',
              textDecoration: 'none',
              color: 'var(--text-primary)',
              border: '1px solid rgba(90, 74, 66, 0.08)',
              fontWeight: 700,
            }}
          >
            📊 ダッシュボードを開く
          </a>
          <code
            style={{
              padding: '10px 12px',
              borderRadius: '999px',
              background: 'rgba(255, 255, 255, 0.7)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              fontSize: '0.86rem',
            }}
          >
            LLM API: /api/copilot
          </code>
        </div>
      </section>

      <section style={{ marginTop: '28px', display: 'grid', gap: '18px' }}>
        <div style={{ ...cardStyle, padding: '24px' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '14px' }}>
            初心者向け: 3 ステップで慣れる
          </h2>
          <div style={{ display: 'grid', gap: '12px' }}>
            {learningSteps.map((item) => (
              <article
                key={item.step}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '56px 1fr',
                  gap: '14px',
                  padding: '16px',
                  borderRadius: '14px',
                  background: 'var(--secondary-bg)',
                }}
              >
                <span
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    background: 'var(--accent-peachy)',
                    fontWeight: 800,
                    color: 'var(--text-primary)',
                  }}
                >
                  {item.step}
                </span>
                <div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '4px' }}>{item.title}</h3>
                  <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '0.92rem' }}>
                    {item.body}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '18px' }}>
          <section style={{ ...cardStyle, padding: '22px' }}>
            <h2 style={{ fontSize: '1.12rem', fontWeight: 800, marginBottom: '12px' }}>
              CopHarness の利用シーン
            </h2>
            <ul style={{ display: 'grid', gap: '10px', paddingLeft: '18px', color: 'var(--text-secondary)' }}>
              {scenarios.map((scenario) => (
                <li key={scenario} style={{ lineHeight: 1.65 }}>{scenario}</li>
              ))}
            </ul>
          </section>

          <section style={{ ...cardStyle, padding: '22px' }}>
            <h2 style={{ fontSize: '1.12rem', fontWeight: 800, marginBottom: '12px' }}>
              そのまま試せるプロンプト例
            </h2>
            <div style={{ display: 'grid', gap: '10px' }}>
              {promptExamples.map((prompt) => (
                <p
                  key={prompt}
                  style={{
                    padding: '12px',
                    borderRadius: '12px',
                    background: '#fff',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    lineHeight: 1.55,
                    fontSize: '0.9rem',
                  }}
                >
                  “{prompt}”
                </p>
              ))}
            </div>
          </section>
        </div>

        <section style={{ ...cardStyle, padding: '22px', background: 'rgba(255, 255, 255, 0.82)' }}>
          <h2 style={{ fontSize: '1.12rem', fontWeight: 800, marginBottom: '12px' }}>
            安全に運用するための tips
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
            {safetyTips.map((tip) => (
              <div
                key={tip}
                style={{
                  padding: '14px',
                  borderRadius: '14px',
                  background: 'var(--secondary-bg)',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.65,
                  fontSize: '0.9rem',
                }}
              >
                🛡️ {tip}
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
