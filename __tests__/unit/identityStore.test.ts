import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  _resetIdentityStoreForTests,
  getIdentity,
  getPerson,
  linkIdentity,
  listPeople,
  makeChannelKey,
  resolveConversationKey,
  resolveIdentity,
} from '../../lib/identity/store';

describe('identity store', () => {
  let tmpDir: string;
  let storeFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-identities-'));
    storeFile = path.join(tmpDir, 'identities.json');
    process.env.IDENTITY_STORE_FILE = storeFile;
    _resetIdentityStoreForTests();
  });

  afterEach(() => {
    delete process.env.IDENTITY_STORE_FILE;
    _resetIdentityStoreForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a stable person for a channel identity', async () => {
    const first = await resolveIdentity('line', 'user-1');
    const second = await resolveIdentity('line', 'user-1');

    expect(first.channelKey).toBe('line:user-1');
    expect(second.personId).toBe(first.personId);
    expect(getIdentity('line', 'user-1')?.personId).toBe(first.personId);
    expect(getPerson(first.personId)?.channelKeys).toEqual(['line:user-1']);
  });

  it('links multiple channel identities to the same person', async () => {
    const line = await resolveIdentity('line', 'user-1', { displayName: 'Ada' });
    const discord = await linkIdentity(line.personId, 'discord', 'discord-1', 'Ada Lovelace');

    expect(discord.personId).toBe(line.personId);
    expect(getPerson(line.personId)?.channelKeys.sort()).toEqual(['discord:discord-1', 'line:user-1']);
    expect(listPeople()).toHaveLength(1);
  });

  it('returns a person-scoped conversation key separate from channel key', async () => {
    const resolved = await resolveConversationKey('api', 'subject-1');

    expect(resolved.channelKey).toBe('api:subject-1');
    expect(resolved.conversationKey).toBe(`person:${resolved.personId}`);
  });

  it('normalizes channels and rejects empty inputs', () => {
    expect(makeChannelKey('Discord', '123')).toBe('discord:123');
    expect(() => makeChannelKey('', '123')).toThrow('channel is required');
    expect(() => makeChannelKey('line', '')).toThrow('subject is required');
  });
});
