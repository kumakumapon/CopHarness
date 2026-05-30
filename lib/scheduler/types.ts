export interface ScheduledPrompt {
  id: string;
  name: string;
  /** 5-field cron expression or HH:MM shorthand */
  cron: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  /** When true, daemon will execute this schedule immediately on the next poll. */
  runNow?: boolean;
  /** When true, daemon will abort any in-flight execution of this schedule. */
  stopRequested?: boolean;
  /** Discord channel ID to post the result to after execution. */
  discordChannelId?: string;
  /** LINE user ID to push the result to after execution. */
  lineUserId?: string;
}

export interface ScheduleStore {
  schedules: ScheduledPrompt[];
}
