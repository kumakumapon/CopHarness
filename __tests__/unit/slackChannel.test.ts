import { normalizeSlackEvent } from '../../lib/channels/slack';

describe('normalizeSlackEvent', () => {
  it('handles Slack URL verification challenges', () => {
    expect(normalizeSlackEvent({ type: 'url_verification', challenge: 'abc' })).toEqual({
      type: 'url_verification',
      challenge: 'abc',
      shouldRespond: true,
    });
  });

  it('normalizes direct messages with identity and thread keys', () => {
    expect(normalizeSlackEvent({
      event: {
        type: 'message',
        channel_type: 'im',
        user: 'U123',
        channel: 'D123',
        ts: '1000.0001',
        text: 'hello',
      },
    })).toMatchObject({
      type: 'message',
      userId: 'U123',
      channelId: 'D123',
      threadKey: 'slack:D123:1000.0001',
      channelKey: 'slack:U123',
      shouldRespond: true,
    });
  });

  it('normalizes app mentions using thread_ts when present', () => {
    expect(normalizeSlackEvent({
      event: {
        type: 'app_mention',
        user: 'U123',
        channel: 'C123',
        ts: '1000.0001',
        thread_ts: '999.0001',
        text: '<@BOT> help',
      },
    }).threadKey).toBe('slack:C123:999.0001');
  });

  it('ignores bot messages', () => {
    expect(normalizeSlackEvent({ event: { type: 'message', bot_id: 'B123' } }).shouldRespond).toBe(false);
  });
});
