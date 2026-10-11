'use client';

import {
  Clock,
  Activity,
} from 'lucide-react';
import type { IdentitiesData } from './types';
import { fmtDate } from './shared';
import { TASK_STATUS_STYLES } from './TasksPanel';


export function IdentitiesPanel({ data }: { data: IdentitiesData | undefined }) {
  return (
    <section className="mb-6">
      <h2
        className="text-sm font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        <Activity className="w-4 h-4" /> 人物 / チャネル / タスク
        {data && (
          <span className="ml-auto text-xs font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>
            人物 {data.total} 件
          </span>
        )}
      </h2>

      {!data ? (
        <div className="h-28 rounded-xl animate-pulse" style={{ background: 'var(--secondary-bg)' }} />
      ) : data.people.length === 0 ? (
        <div className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--secondary-bg)', color: 'var(--text-secondary)' }}>
          まだ人物 ID はありません。LINE / Discord / API から会話すると IdentityStore に追加されます。
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.people.map((person) => (
            <div
              key={person.personId}
              className="rounded-xl p-4"
              style={{ background: 'var(--secondary-bg)', border: '1px solid var(--border-color)' }}
            >
              <div className="flex flex-wrap items-start gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                    {person.displayName || person.personId}
                  </div>
                  <div className="font-mono text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                    {person.personId}
                  </div>
                </div>
                {person.runningTaskCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
                    <Clock className="w-3 h-3" /> 実行中 {person.runningTaskCount}
                  </span>
                )}
              </div>

              <div className="mb-3">
                <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                  チャネル ({person.channelCount})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {person.channelIdentities.map((identity) => (
                    <span
                      key={identity.channelKey}
                      className="inline-block px-2 py-0.5 rounded-full text-xs font-mono"
                      style={{ background: 'var(--primary-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                      title={identity.displayName ? `${identity.displayName} / ${identity.channelKey}` : identity.channelKey}
                    >
                      {identity.channelKey}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                  最近のタスク ({person.taskCount})
                </div>
                {person.recentTasks.length === 0 ? (
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>タスク履歴はまだありません。</div>
                ) : (
                  <div className="space-y-1.5">
                    {person.recentTasks.map((task) => {
                      const st = TASK_STATUS_STYLES[task.status] ?? TASK_STATUS_STYLES.running;
                      return (
                        <div key={task.id} className="flex items-center gap-2 text-xs min-w-0">
                          <span className={`shrink-0 inline-block px-1.5 py-0.5 rounded ${st.bg} ${st.text}`}>{st.label}</span>
                          <span className="font-mono shrink-0" style={{ color: 'var(--text-secondary)' }}>{task.kind}</span>
                          <span className="truncate" style={{ color: 'var(--text-primary)' }} title={task.title || task.id}>
                            {task.title || task.id}
                          </span>
                          <span className="shrink-0 ml-auto" style={{ color: 'var(--text-secondary)' }}>{fmtDate(task.updatedAt)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
