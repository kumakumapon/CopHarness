


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderStatus {
  name: string;
  configured: boolean;
  detail?: string;
}


export interface StatusData {
  activeProvider: string;
  activeModel: string;
  configuredCount: number;
  totalCount: number;
  providers: ProviderStatus[];
  bots: ProviderStatus[];
  checkedAt: string;
}


export interface Schedule {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  nextRun?: string | null;
  runNow?: boolean;
  stopRequested?: boolean;
  discordChannelId?: string;
  lineUserId?: string;
}


export interface SchedulesData {
  schedules: Schedule[];
}


export interface Watcher {
  id: string;
  name: string;
  type: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt?: string;
  triggerCount: number;
  eventPattern?: string;
  discordChannelId?: string;
  lineUserId?: string;
}


export interface WatchersData {
  watchers: Watcher[];
}


interface LogEntry {
  id: string;
  scheduleId: string;
  scheduleName: string;
  prompt: string;
  startedAt: string;
  finishedAt?: string;
  status?: 'success' | 'failed' | 'aborted';
  result?: string;
  error?: string;
  reason: string;
}


export interface LogsData {
  logs: LogEntry[];
}


interface SkillExecutionMetrics {
  skillName: string;
  totalRuns: number;
  successRuns: number;
  errorRuns: number;
  exceptionRuns: number;
  successRate: number | null;
  averageDurationMs: number | null;
  lastRunAt?: string;
  lastStatus?: 'success' | 'error' | 'exception';
  lastErrorPreview?: string;
}


interface SkillApprovalPolicy {
  mode: 'alwaysAllow' | 'allowWithDryRun' | 'requireApproval' | 'deny' | 'allowForSession';
  decision: 'allowed' | 'dry_run_allowed' | 'approval_required' | 'denied';
  ruleId?: string;
  reason: string;
}


export interface Skill {
  name: string;
  description: string;
  category: string;
  riskLevel: 'low' | 'medium' | 'high';
  requiresEnv: string[];
  enabled: boolean;
  approvalPolicy?: SkillApprovalPolicy;
  metrics: SkillExecutionMetrics;
}


export interface SkillsData {
  skills: Skill[];
}


interface SkillExecutionRecord {
  id: string;
  skillName: string;
  personId?: string;
  channelKey?: string;
  taskId?: string;
  approvalId?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'success' | 'error' | 'exception';
  riskLevel?: 'low' | 'medium' | 'high';
  argsPreview: string;
  resultPreview?: string;
  errorPreview?: string;
}


export interface SkillExecutionsData {
  executions: SkillExecutionRecord[];
  total: number;
}


export interface SkillExecutionFilters {
  status: '' | 'success' | 'error' | 'exception';
  riskLevel: '' | 'low' | 'medium' | 'high';
  personQuery: string;
  channelQuery: string;
  taskQuery: string;
  from: string;
  to: string;
}


export interface DashboardTask {
  id: string;
  kind: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'iteration_limit' | 'stalled' | 'waiting_input';
  personId?: string;
  channelKey?: string;
  conversationKey?: string;
  title?: string;
  createdAt?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  errorPreview?: string;
  metadata?: Record<string, unknown>;
}


export interface DashboardAgentDagPlan {
  id: string;
  role: string;
  prompt?: string;
  dependsOn?: string[];
  skills?: string[];
  timeoutMs?: number;
  workspace?: string;
}


interface DashboardAgentDagProgress {
  planId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}


export interface DashboardAgentDag {
  runId: string;
  status: 'running' | 'succeeded' | 'failed';
  plans: DashboardAgentDagPlan[];
  progress: DashboardAgentDagProgress[];
  updatedAt?: string;
}


export interface TasksData {
  tasks: DashboardTask[];
  total: number;
}


export interface TaskFilters {
  status: '' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'iteration_limit' | 'stalled' | 'waiting_input';
  kindQuery: string;
  personQuery: string;
  channelQuery: string;
  from: string;
  to: string;
}


interface DashboardChannelIdentity {
  channel: string;
  subject: string;
  channelKey: string;
  displayName?: string;
  updatedAt: string;
}


interface DashboardPerson {
  personId: string;
  displayName?: string;
  updatedAt: string;
  channelKeys: string[];
  channelIdentities: DashboardChannelIdentity[];
  channelCount: number;
  taskCount: number;
  runningTaskCount: number;
  recentTasks: DashboardTask[];
}


export interface IdentitiesData {
  people: DashboardPerson[];
  total: number;
}


interface ApprovalPreview {
  summary: string;
  generatedAt: number;
  available: boolean;
  details?: Record<string, unknown>;
  diff?: string;
  command?: string;
  targets?: string[];
  externalDestinations?: string[];
  riskAttributes?: string[];
  unavailableReason?: string;
}


interface ApprovalRequest {
  id: string;
  skillName: string;
  args: Record<string, unknown>;
  createdAt: number;
  resolvedAt?: number;
  status: 'pending' | 'approved' | 'rejected' | 'timeout';
  requestedBy?: string;
  policyRuleId?: string;
  preview?: ApprovalPreview;
}


export interface ApprovalsData {
  approvals: ApprovalRequest[];
  total: number;
}


interface TelemetrySpan {
  traceId: string;
  spanId: string;
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  attributes: Record<string, string | number | boolean>;
  status: 'UNSET' | 'OK' | 'ERROR';
  statusMessage?: string;
}


export interface TelemetryData {
  spans: TelemetrySpan[];
  total: number;
}


interface SchemaViolation {
  id: string;
  skillName: string;
  timestamp: string;
  errors: string[];
  contentPreview: string;
}


export interface ViolationsData {
  violations: SchemaViolation[];
  total: number;
}


interface TokenUsageSummaryEntry {
  provider: string;
  model: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  requestCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}


export interface TokenUsageData {
  usage: TokenUsageSummaryEntry[];
}


interface SkillProposalTestResult {
  index: number;
  passed: boolean;
  detail?: string;
}


interface DashboardSkillProposal {
  id: string;
  name: string;
  description: string;
  problem: string;
  riskLevel: 'low' | 'medium' | 'high';
  status:
    | 'draft'
    | 'testing'
    | 'tests_failed'
    | 'awaiting_approval'
    | 'approved'
    | 'rejected'
    | 'registered';
  testResults?: SkillProposalTestResult[];
  createdAt: string;
  updatedAt: string;
}


export interface SkillProposalsData {
  proposals: DashboardSkillProposal[];
  total: number;
}


export type SkillProposalStatusFilter =
  | ''
  | 'draft'
  | 'testing'
  | 'tests_failed'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'registered';


export interface ToolsetSkillEntry {
  name: string;
  riskLevel: 'low' | 'medium' | 'high';
  active: boolean;
  registered: boolean;
}


interface ToolsetEntry {
  name: string;
  description: string;
  source: 'builtin' | 'custom';
  skillCount: number;
  skills: ToolsetSkillEntry[];
}


interface McpServerEntry {
  name: string;
  url: string;
  toolCount: number;
  loadedToolNames: string[];
  skippedToolNames: string[];
  includeTools?: string[];
  excludeTools?: string[];
  loadedAt: string;
  error?: string;
}


export interface ToolsetsData {
  toolsets: ToolsetEntry[];
  mcpServers: McpServerEntry[];
}


interface ConversationEntry {
  key: string;
  messageCount: number;
  updatedAt: number;
}


export interface ConversationsData {
  conversations: ConversationEntry[];
}
