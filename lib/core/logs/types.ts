export type LogStatus = 'success' | 'failed' | 'aborted';

export interface ExecutionLog {
  id: string;
  scheduleId: string;
  scheduleName: string;
  prompt: string;
  startedAt: string;
  finishedAt?: string;
  status?: LogStatus;
  result?: string;
  error?: string;
  /** 'cron' or 'manual fire' */
  reason: string;
}

export interface LogStore {
  logs: ExecutionLog[];
}
