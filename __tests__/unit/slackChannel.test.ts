import { createHmac } from 'node:crypto';
import { normalizeSlackEvent, validateSlackSignature } from '../../lib/channels/slack';

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


describe('validateSlackSignature', () => {
  const secret = 'test-secret';
  const timestamp = '1700000000';
  const body = '{"type":"url_verification"}';
  const signature = 'v0=' + createHmac('sha256', secret).update('v0:' + timestamp + ':' + body).digest('hex');

  it('accepts a valid, recent Slack signature', () => {
    expect(validateSlackSignature(body, timestamp, signature, secret, Number(timestamp) * 1000)).toBe(true);
  });

  it('rejects altered bodies and stale timestamps', () => {
    expect(validateSlackSignature(body + 'x', timestamp, signature, secret, Number(timestamp) * 1000)).toBe(false);
    expect(validateSlackSignature(body, timestamp, signature, secret, Number(timestamp) * 1000 + 300_001)).toBe(false);
  });
});
