import { type SkillDefinition } from '../skill';

/**
 * Notification skill supporting Slack Incoming Webhooks and Discord Webhooks.
 * Configure via:
 *   SLACK_WEBHOOK_URL   — Slack Incoming Webhook URL
 *   DISCORD_WEBHOOK_URL — Discord Webhook URL
 */

export const sendNotification: SkillDefinition = {
  name: 'sendNotification',
  description:
    'Sends a notification message to Slack or Discord via webhooks. ' +
    'Configure SLACK_WEBHOOK_URL and/or DISCORD_WEBHOOK_URL environment variables.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The notification message to send.',
      },
      target: {
        type: 'string',
        description: 'Destination: "slack", "discord", or "all". Defaults to "all".',
        enum: ['slack', 'discord', 'all'],
      },
    },
    required: ['message'],
  },
  category: 'external',
  riskLevel: 'high',
  requiresEnv: ['SLACK_WEBHOOK_URL', 'DISCORD_WEBHOOK_URL'],
  handler: async (args) => {
    const message = String(args.message ?? '').trim();
    if (!message) return { content: 'Error: message is required', isError: true };
    const target = String(args.target ?? 'all').toLowerCase();

    const slackUrl = process.env.SLACK_WEBHOOK_URL;
    const discordUrl = process.env.DISCORD_WEBHOOK_URL;

    const results: string[] = [];
    const errors: string[] = [];

    async function sendSlack() {
      if (!slackUrl) { errors.push('SLACK_WEBHOOK_URL is not set'); return; }
      try {
        const res = await fetch(slackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: message }),
        });
        if (!res.ok) errors.push(`Slack: HTTP ${res.status} ${res.statusText}`);
        else results.push('Slack: ✅ sent');
      } catch (err) {
        errors.push(`Slack: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    async function sendDiscord() {
      if (!discordUrl) { errors.push('DISCORD_WEBHOOK_URL is not set'); return; }
      try {
        const res = await fetch(discordUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: message }),
        });
        if (!res.ok) errors.push(`Discord: HTTP ${res.status} ${res.statusText}`);
        else results.push('Discord: ✅ sent');
      } catch (err) {
        errors.push(`Discord: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (target === 'slack') {
      await sendSlack();
    } else if (target === 'discord') {
      await sendDiscord();
    } else {
      await Promise.all([sendSlack(), sendDiscord()]);
    }

    const parts = [...results, ...errors.map((e) => `⚠️ ${e}`)];
    const hasFailure = errors.length > 0 && results.length === 0;
    return { content: parts.join('\n') || 'No webhook URLs configured.', isError: hasFailure };
  },
};
