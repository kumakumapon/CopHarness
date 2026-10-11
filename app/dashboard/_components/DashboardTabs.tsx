'use client';





export type DashboardTab = 'overview' | 'operations' | 'observability' | 'governance' | 'tools';


const DASHBOARD_TABS: { id: DashboardTab; label: string; description: string }[] = [
  { id: 'overview', label: '概要', description: '状態・直近ログ' },
  { id: 'operations', label: '運用', description: 'スケジュール・タスク' },
  { id: 'observability', label: '観測', description: 'Telemetry・Token' },
  { id: 'governance', label: '承認', description: 'HITL・違反' },
  { id: 'tools', label: 'ツール', description: 'Skills・Toolsets' },
];


function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'var(--text-primary)' : 'rgba(255,255,255,0.52)',
    color: active ? 'var(--primary-bg)' : 'var(--text-primary)',
    border: `1px solid ${active ? 'var(--text-primary)' : 'var(--border-color)'}`,
    boxShadow: active ? '0 10px 24px rgba(90,74,66,0.18)' : '0 1px 8px var(--shadow-light)',
  };
}


export function DashboardTabs({ activeTab, onChange }: { activeTab: DashboardTab; onChange: (tab: DashboardTab) => void }) {
  return (
    <nav
      className="sticky top-0 z-20 -mx-4 mb-6 border-y px-4 py-3 backdrop-blur-xl md:top-3 md:mx-0 md:rounded-2xl md:border"
      style={{
        background: 'rgba(250,246,241,0.82)',
        borderColor: 'var(--border-color)',
        boxShadow: '0 8px 24px var(--shadow-light)',
      }}
      aria-label="Dashboard sections"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {DASHBOARD_TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className="rounded-xl px-3 py-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
              style={tabButtonStyle(active)}
              aria-pressed={active}
            >
              <div className="text-sm font-bold">{tab.label}</div>
              <div className="mt-0.5 hidden text-[11px] opacity-75 lg:block">{tab.description}</div>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
