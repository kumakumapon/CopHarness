export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timeout';

export interface ApprovalRequest {
  id: string;
  skillName: string;
  args: Record<string, unknown>;
  createdAt: number;
  resolvedAt?: number;
  status: ApprovalStatus;
  requestedBy?: string;
}
