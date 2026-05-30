export interface AgentRole {
  name: string;
  description: string;
  systemPrompt: string;
}

export interface AgentTask {
  role: AgentRole | string;
  userPrompt: string;
  skills?: string[];
  timeoutMs?: number;
  model?: string;
}

export interface AgentResult {
  role: string;
  content: string;
  model?: string;
  provider?: string;
  durationMs: number;
  error?: string;
}
