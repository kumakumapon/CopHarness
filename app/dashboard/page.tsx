'use client';

import { useState, useMemo } from 'react';
import useSWR from 'swr';
import { fetcher } from './_components/api';
import type { ApprovalsData, ConversationsData, IdentitiesData, LogsData, SchedulesData, SkillExecutionFilters, SkillExecutionsData, SkillProposalStatusFilter, SkillProposalsData, SkillsData, StatusData, TaskFilters, TasksData, TelemetryData, TokenUsageData, ToolsetsData, ViolationsData, WatchersData } from './_components/types';
import { ApprovalsPanel } from './_components/ApprovalsPanel';
import { ConversationsPanel } from './_components/ConversationsPanel';
import { DashboardTab, DashboardTabs } from './_components/DashboardTabs';
import { IdentitiesPanel } from './_components/IdentitiesPanel';
import { LogFeed } from './_components/LogFeed';
import { SchedulerPanel } from './_components/SchedulerPanel';
import { SearchPanel } from './_components/SearchPanel';
import { SkillProposalsPanel } from './_components/SkillProposalsPanel';
import { SkillsPanel } from './_components/SkillsPanel';
import { StatusCards, SummaryBanner } from './_components/StatusPanels';
import { TasksPanel } from './_components/TasksPanel';
import { TelemetryPanel } from './_components/TelemetryPanel';
import { TokenUsagePanel } from './_components/TokenUsagePanel';
import { ToolsetsPanel } from './_components/ToolsetsPanel';
import { ViolationsPanel } from './_components/ViolationsPanel';
import { WatchersPanel } from './_components/WatchersPanel';


// ---------------------------------------------------------------------------
// Main Dashboard Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [skillExecutionFilters, setSkillExecutionFilters] = useState<SkillExecutionFilters>({
    status: '',
    riskLevel: '',
    personQuery: '',
    channelQuery: '',
    taskQuery: '',
    from: '',
    to: '',
  });
  const [taskFilters, setTaskFilters] = useState<TaskFilters>({
    status: '',
    kindQuery: '',
    personQuery: '',
    channelQuery: '',
    from: '',
    to: '',
  });
  const [skillProposalStatusFilter, setSkillProposalStatusFilter] =
    useState<SkillProposalStatusFilter>('');
  const refreshInterval = autoRefresh ? 30_000 : 0;
  const showOverview = activeTab === 'overview';
  const showOperations = activeTab === 'operations';
  const showObservability = activeTab === 'observability';
  const showGovernance = activeTab === 'governance';
  const showTools = activeTab === 'tools';
  const skillProposalsUrl = useMemo(() => {
    const params = new URLSearchParams({ limit: '50' });
    if (skillProposalStatusFilter) params.set('status', skillProposalStatusFilter);
    return `/api/dashboard/skill-proposals?${params.toString()}`;
  }, [skillProposalStatusFilter]);
  const skillExecutionsUrl = useMemo(() => {
    const params = new URLSearchParams({ limit: '50' });
    Object.entries(skillExecutionFilters).forEach(([key, value]) => {
      if (!value) return;
      params.set(key, key === 'to' ? `${value}T23:59:59` : value);
    });
    return `/api/dashboard/skill-executions?${params.toString()}`;
  }, [skillExecutionFilters]);
  const tasksUrl = useMemo(() => {
    const params = new URLSearchParams({ limit: '50' });
    Object.entries(taskFilters).forEach(([key, value]) => {
      if (!value) return;
      params.set(key, key === 'to' ? `${value}T23:59:59` : value);
    });
    return `/api/dashboard/tasks?${params.toString()}`;
  }, [taskFilters]);

  const { data: statusData, mutate: mutateStatus } =
    useSWR<StatusData>('/api/dashboard/status', fetcher, { refreshInterval });
  const { data: schedulesData, mutate: mutateSchedules } =
    useSWR<SchedulesData>(showOperations ? '/api/dashboard/schedules' : null, fetcher, { refreshInterval });
  const { data: watchersData, mutate: mutateWatchers } =
    useSWR<WatchersData>(showOperations ? '/api/dashboard/watchers' : null, fetcher, { refreshInterval });
  const { data: logsData, mutate: mutateLogs } =
    useSWR<LogsData>(showOverview ? '/api/dashboard/logs?limit=20' : null, fetcher, { refreshInterval });
  const { data: skillsData } =
    useSWR<SkillsData>(showTools ? '/api/dashboard/skills' : null, fetcher);
  const { data: skillExecutionsData, mutate: mutateSkillExecutions } =
    useSWR<SkillExecutionsData>(showTools ? skillExecutionsUrl : null, fetcher, { refreshInterval });
  const { data: approvalsData, mutate: mutateApprovals } =
    useSWR<ApprovalsData>(showGovernance ? '/api/dashboard/approvals' : null, fetcher, { refreshInterval: 3_000 });
  const { data: identitiesData, mutate: mutateIdentities } =
    useSWR<IdentitiesData>(showOperations ? '/api/dashboard/identities?limit=50&recentTaskLimit=3' : null, fetcher, { refreshInterval });
  const { data: tasksData, mutate: mutateTasks } =
    useSWR<TasksData>(showOperations ? tasksUrl : null, fetcher, { refreshInterval });
  const { data: telemetryData } =
    useSWR<TelemetryData>(showObservability ? '/api/dashboard/telemetry?limit=50' : null, fetcher, { refreshInterval });
  const { data: violationsData } =
    useSWR<ViolationsData>(showGovernance ? '/api/dashboard/violations?limit=50' : null, fetcher, { refreshInterval });
  const { data: skillProposalsData, mutate: mutateSkillProposals } =
    useSWR<SkillProposalsData>(showGovernance ? skillProposalsUrl : null, fetcher, { refreshInterval });
  const { data: toolsetsData } =
    useSWR<ToolsetsData>(showTools ? '/api/dashboard/toolsets' : null, fetcher);
  const { data: tokenUsageData } =
    useSWR<TokenUsageData>(showObservability ? '/api/dashboard/token-usage' : null, fetcher, { refreshInterval });
  const { data: conversationsData, mutate: mutateConversations } =
    useSWR<ConversationsData>(showOperations ? '/api/dashboard/conversations?limit=100' : null, fetcher, { refreshInterval });

  function refreshAll() {
    void mutateStatus();
    void mutateSchedules();
    void mutateWatchers();
    void mutateLogs();
    void mutateApprovals();
    void mutateIdentities();
    void mutateTasks();
    void mutateSkillExecutions();
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--primary-bg)' }}>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <SummaryBanner
          data={statusData}
          autoRefresh={autoRefresh}
          onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
          onRefresh={refreshAll}
        />
        <DashboardTabs activeTab={activeTab} onChange={setActiveTab} />

        {showOverview && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div>
              <StatusCards data={statusData} />
              <SearchPanel />
            </div>
            <LogFeed data={logsData} />
          </div>
        )}

        {showOperations && (
          <>
            <SchedulerPanel data={schedulesData} onMutate={() => { void mutateSchedules(); void mutateLogs(); }} />
            <WatchersPanel data={watchersData} onMutate={() => { void mutateWatchers(); void mutateLogs(); void mutateTasks(); }} />
            <TasksPanel
              data={tasksData}
              filters={taskFilters}
              onFiltersChange={setTaskFilters}
              onSkillExecutionFiltersChange={setSkillExecutionFilters}
              onTasksMutate={() => void mutateTasks()}
            />
            <IdentitiesPanel data={identitiesData} />
            <ConversationsPanel data={conversationsData} onMutate={() => void mutateConversations()} />
          </>
        )}

        {showObservability && (
          <>
            <TelemetryPanel data={telemetryData} />
            <TokenUsagePanel data={tokenUsageData} />
          </>
        )}

        {showGovernance && (
          <>
            <ApprovalsPanel data={approvalsData} onMutate={() => void mutateApprovals()} />
            <SkillProposalsPanel
              data={skillProposalsData}
              statusFilter={skillProposalStatusFilter}
              onStatusFilterChange={setSkillProposalStatusFilter}
              onMutate={() => void mutateSkillProposals()}
            />
            <ViolationsPanel data={violationsData} />
          </>
        )}

        {showTools && (
          <>
            <ToolsetsPanel data={toolsetsData} />
            <SkillsPanel
              data={skillsData}
              executionsData={skillExecutionsData}
              executionFilters={skillExecutionFilters}
              onExecutionFiltersChange={setSkillExecutionFilters}
            />
          </>
        )}
      </div>
    </div>
  );
}
