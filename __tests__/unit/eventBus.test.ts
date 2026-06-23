import { EventBus } from '../../lib/events/bus';
import type { BusEvent, AdapterResponsePayload, SkillStartPayload } from '../../lib/events/bus';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus(50);
  });

  afterEach(() => {
    bus.removeAllListeners();
  });

  it('emits events to typed listeners', () => {
    const received: BusEvent<AdapterResponsePayload>[] = [];
    bus.on('adapter:response', (event) => {
      received.push(event);
    });

    bus.emit('adapter:response', {
      provider: 'openai',
      model: 'gpt-4o',
      durationMs: 500,
      contentLength: 100,
      usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('adapter:response');
    expect(received[0].payload.provider).toBe('openai');
    expect(received[0].payload.durationMs).toBe(500);
    expect(received[0].timestamp).toBeDefined();
  });

  it('does not deliver events to unrelated listeners', () => {
    const received: unknown[] = [];
    bus.on('skill:start', (event) => {
      received.push(event);
    });

    bus.emit('adapter:response', {
      provider: 'openai',
      model: 'gpt-4o',
      durationMs: 500,
      contentLength: 100,
    });

    expect(received).toHaveLength(0);
  });

  it('wildcard listener receives all events', () => {
    const received: BusEvent[] = [];
    bus.onAny((event) => {
      received.push(event);
    });

    bus.emit('adapter:request', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      messageCount: 3,
      hasSkills: true,
    });
    bus.emit('skill:start', {
      skillName: 'calculator',
      args: { expression: '1+1' },
    });

    expect(received).toHaveLength(2);
    expect(received[0].type).toBe('adapter:request');
    expect(received[1].type).toBe('skill:start');
  });

  it('unsubscribe stops delivery', () => {
    const received: unknown[] = [];
    const unsub = bus.on('skill:start', (event) => {
      received.push(event);
    });

    bus.emit('skill:start', { skillName: 'a', args: {} });
    expect(received).toHaveLength(1);

    unsub();
    bus.emit('skill:start', { skillName: 'b', args: {} });
    expect(received).toHaveLength(1);
  });

  it('once listener fires only once', () => {
    const received: unknown[] = [];
    bus.once('adapter:error', (event) => {
      received.push(event);
    });

    bus.emit('adapter:error', {
      provider: 'openai',
      model: 'gpt-4o',
      error: 'timeout',
      durationMs: 10000,
      retryable: true,
    });
    bus.emit('adapter:error', {
      provider: 'openai',
      model: 'gpt-4o',
      error: 'timeout again',
      durationMs: 10000,
      retryable: true,
    });

    expect(received).toHaveLength(1);
  });

  it('maintains event history', () => {
    bus.emit('skill:start', { skillName: 'a', args: {} });
    bus.emit('skill:start', { skillName: 'b', args: {} });
    bus.emit('skill:end', { skillName: 'a', durationMs: 10, resultLength: 5, isError: false });

    const history = bus.getHistory();
    expect(history).toHaveLength(3);

    const skillStarts = bus.getHistory({ type: 'skill:start' });
    expect(skillStarts).toHaveLength(2);
  });

  it('limits history size', () => {
    const smallBus = new EventBus(3);
    for (let i = 0; i < 10; i++) {
      smallBus.emit('skill:start', { skillName: `skill_${i}`, args: {} });
    }

    const history = smallBus.getHistory();
    expect(history).toHaveLength(3);
    expect((history[0].payload as SkillStartPayload).skillName).toBe('skill_7');
    expect((history[2].payload as SkillStartPayload).skillName).toBe('skill_9');
  });

  it('filters history by since timestamp', async () => {
    bus.emit('skill:start', { skillName: 'early', args: {} });
    const afterFirst = new Date().toISOString();

    // Small delay to ensure timestamps differ
    await new Promise((r) => setTimeout(r, 5));

    bus.emit('skill:start', { skillName: 'late', args: {} });

    const filtered = bus.getHistory({ since: afterFirst });
    expect(filtered).toHaveLength(1);
    expect((filtered[0].payload as SkillStartPayload).skillName).toBe('late');
  });

  it('limits history results', () => {
    for (let i = 0; i < 10; i++) {
      bus.emit('skill:start', { skillName: `s${i}`, args: {} });
    }

    const limited = bus.getHistory({ limit: 3 });
    expect(limited).toHaveLength(3);
    expect((limited[0].payload as SkillStartPayload).skillName).toBe('s7');
  });

  it('clear removes all history', () => {
    bus.emit('skill:start', { skillName: 'x', args: {} });
    expect(bus.getHistory()).toHaveLength(1);
    bus.clear();
    expect(bus.getHistory()).toHaveLength(0);
  });

  it('removeAllListeners stops all delivery', () => {
    const received: unknown[] = [];
    bus.on('skill:start', (e) => received.push(e));
    bus.onAny((e) => received.push(e));

    bus.removeAllListeners();
    bus.emit('skill:start', { skillName: 'x', args: {} });
    expect(received).toHaveLength(0);
  });

  it('listenerCount returns correct counts', () => {
    expect(bus.listenerCount()).toBe(0);

    bus.on('skill:start', () => {});
    bus.on('skill:start', () => {});
    bus.on('adapter:response', () => {});
    bus.onAny(() => {});

    expect(bus.listenerCount('skill:start')).toBe(3); // 2 typed + 1 wildcard
    expect(bus.listenerCount('adapter:response')).toBe(2); // 1 typed + 1 wildcard
    expect(bus.listenerCount()).toBe(4); // 3 typed + 1 wildcard
  });

  it('listener errors do not affect other listeners', () => {
    const received: string[] = [];
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    bus.on('skill:start', () => {
      throw new Error('listener crash');
    });
    bus.on('skill:start', (e) => {
      received.push((e.payload as SkillStartPayload).skillName);
    });

    bus.emit('skill:start', { skillName: 'safe', args: {} });
    expect(received).toEqual(['safe']);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('emits proper timestamps', () => {
    const before = new Date().toISOString();
    bus.emit('system:error', { source: 'test', error: 'test', fatal: false });
    const after = new Date().toISOString();

    const history = bus.getHistory();
    expect(history[0].timestamp >= before).toBe(true);
    expect(history[0].timestamp <= after).toBe(true);
  });
});
