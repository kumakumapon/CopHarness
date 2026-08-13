import { normalizeGitHubWebhookEvent } from '../../lib/watchers/github';

describe('GitHub watcher event normalization', () => {
  it('normalizes issue webhook payloads for matching and TaskLedger metadata', () => {
    const event = normalizeGitHubWebhookEvent({
      eventName: 'issues',
      deliveryId: 'delivery-1',
      payload: {
        action: 'opened',
        repository: { full_name: 'kumakumapon/CopHarness', html_url: 'https://github.com/kumakumapon/CopHarness' },
        issue: {
          number: 89,
          title: 'Tool policy preview',
          html_url: 'https://github.com/kumakumapon/CopHarness/issues/89',
          user: { login: 'octocat' },
          labels: [{ name: 'bug' }, { name: 'priority:high' }],
        },
        sender: { login: 'octocat' },
      },
      receivedAt: '2026-07-04T00:00:00.000Z',
    });

    expect(event).toMatchObject({
      source: 'github',
      type: 'issues.opened',
      subject: 'kumakumapon/CopHarness #89 Tool policy preview',
      receivedAt: '2026-07-04T00:00:00.000Z',
      payload: {
        repository: 'kumakumapon/CopHarness',
        kind: 'issue',
        number: 89,
        author: 'octocat',
        labels: ['bug', 'priority:high'],
        deliveryId: 'delivery-1',
      },
    });
  });
});
