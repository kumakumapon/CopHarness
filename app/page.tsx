export default function Home() {
  return (
    <main
      style={{
        padding: '40px',
        fontFamily: 'sans-serif',
        maxWidth: '560px',
        margin: '0 auto',
      }}
    >
      <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '6px' }}>
        CopHarness
      </h1>
      <p style={{ color: '#888', fontSize: '0.875rem', marginBottom: '32px' }}>
        LLM ハーネス – CLI / Discord / ダッシュボード対応
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <a
          href="/dashboard"
          style={{
            display: 'block',
            padding: '16px 20px',
            borderRadius: '12px',
            background: '#f5f5f5',
            textDecoration: 'none',
            color: '#111',
            border: '1px solid #e0e0e0',
          }}
        >
          <div style={{ fontWeight: '600', marginBottom: '4px' }}>📊 ダッシュボード</div>
          <div style={{ fontSize: '0.875rem', color: '#666' }}>
            スケジューラー・ログ・スキル一覧
          </div>
        </a>

        <a
          href="/prompt-wizard"
          style={{
            display: 'block',
            padding: '16px 20px',
            borderRadius: '12px',
            background: '#f5f5f5',
            textDecoration: 'none',
            color: '#111',
            border: '1px solid #e0e0e0',
          }}
        >
          <div style={{ fontWeight: '600', marginBottom: '4px' }}>🪄 AIプロンプトウィザード</div>
          <div style={{ fontSize: '0.875rem', color: '#666' }}>
            AIとの対話でプロンプトを自動生成 → LLM に実行
          </div>
        </a>
      </div>

      <p style={{ marginTop: '32px', fontSize: '0.8rem', color: '#aaa' }}>
        LLM API エンドポイント: <code>/api/copilot</code>
      </p>
    </main>
  );
}
