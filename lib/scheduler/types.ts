export interface ScheduledPrompt {
  id: string;
  name: string;
  /** 5-field cron expression or HH:MM shorthand */
  cron: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
}

export interface ScheduleStore {
  schedules: ScheduledPrompt[];
}
