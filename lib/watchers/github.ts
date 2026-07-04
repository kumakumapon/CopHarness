import type { WatcherEvent } from './types';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function labelsFrom(issueOrPr: Record<string, unknown> | undefined): string[] {
  const labels = issueOrPr?.labels;
  if (!Array.isArray(labels)) return [];
  return labels
    .map((label) => typeof label === 'string' ? label : stringField(asRecord(label), 'name'))
    .filter((label): label is string => Boolean(label));
}

export function normalizeGitHubWebhookEvent(input: {
  eventName: string;
  deliveryId?: string;
  payload: Record<string, unknown>;
  receivedAt?: string;
}): WatcherEvent {
  const repository = asRecord(input.payload.repository);
  const issue = asRecord(input.payload.issue);
  const pullRequest = asRecord(input.payload.pull_request);
  const comment = asRecord(input.payload.comment);
  const sender = asRecord(input.payload.sender);
  const action = stringField(input.payload, 'action');
  const item = pullRequest ?? issue;
  const number = numberField(item, 'number');
  const title = stringField(item, 'title');
  const repo = stringField(repository, 'full_name') ?? 'unknown';
  const kind = pullRequest ? 'pull_request' : issue ? 'issue' : input.eventName;
  const type = action ? `${input.eventName}.${action}` : input.eventName;
  const subjectParts = [repo, number ? `#${number}` : undefined, title].filter(Boolean);

  return {
    source: 'github',
    type,
    subject: subjectParts.join(' ') || repo,
    payload: {
      provider: 'github',
      eventName: input.eventName,
      action,
      deliveryId: input.deliveryId,
      repository: repo,
      repositoryUrl: stringField(repository, 'html_url'),
      kind,
      number,
      title,
      url: stringField(item, 'html_url') ?? stringField(comment, 'html_url'),
      author: stringField(asRecord(item?.user), 'login') ?? stringField(sender, 'login'),
      sender: stringField(sender, 'login'),
      labels: labelsFrom(item),
      branch: stringField(asRecord(pullRequest?.head), 'ref'),
      baseBranch: stringField(asRecord(pullRequest?.base), 'ref'),
      commentAuthor: stringField(asRecord(comment?.user), 'login'),
      commentUrl: stringField(comment, 'html_url'),
      raw: input.payload,
    },
    receivedAt: input.receivedAt ?? new Date().toISOString(),
  };
}
