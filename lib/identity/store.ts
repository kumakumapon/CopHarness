/**
 * Cross-channel identity store.
 *
 * Maps channel-scoped identities such as `line:<userId>`,
 * `discord:<userId>`, or `api:<subject>` to a stable personId.  This lets
 * channel-specific sessions keep their transport metadata while sharing the
 * same long-lived user/task context when identities are linked.
 *
 * The file path can be overridden with IDENTITY_STORE_FILE. Otherwise it is
 * stored under DATA_DIR (or cwd when DATA_DIR is unset) as identities.json.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { dataPath } from '../utils/dataDir';

export type IdentityChannel = 'line' | 'discord' | 'api' | string;

export interface ChannelIdentity {
  channel: IdentityChannel;
  subject: string;
  channelKey: string;
  personId: string;
  createdAt: string;
  updatedAt: string;
  displayName?: string;
}

export interface PersonIdentity {
  personId: string;
  createdAt: string;
  updatedAt: string;
  displayName?: string;
  channelKeys: string[];
}

interface IdentityStoreFile {
  people: Record<string, PersonIdentity>;
  channelIdentities: Record<string, ChannelIdentity>;
}

export interface IdentityResolution {
  personId: string;
  channelKey: string;
  identity: ChannelIdentity;
  person: PersonIdentity;
}

let _store: IdentityStoreFile | null = null;
let _writeQueue: Promise<void> = Promise.resolve();

function identityStoreFilePath(): string {
  const explicit = process.env.IDENTITY_STORE_FILE;
  if (explicit) return path.resolve(explicit);
  return dataPath('identities.json');
}

export function makeChannelKey(channel: IdentityChannel, subject: string): string {
  const normalizedChannel = String(channel).trim().toLowerCase();
  const normalizedSubject = String(subject).trim();
  if (!normalizedChannel) throw new Error('channel is required');
  if (!normalizedSubject) throw new Error('subject is required');
  return `${normalizedChannel}:${normalizedSubject}`;
}

function emptyStore(): IdentityStoreFile {
  return { people: {}, channelIdentities: {} };
}

function getStore(): IdentityStoreFile {
  if (_store) return _store;
  const filePath = identityStoreFilePath();
  if (!fs.existsSync(filePath)) {
    _store = emptyStore();
    return _store;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<IdentityStoreFile>;
    _store = {
      people: parsed.people && typeof parsed.people === 'object' ? parsed.people : {},
      channelIdentities:
        parsed.channelIdentities && typeof parsed.channelIdentities === 'object'
          ? parsed.channelIdentities
          : {},
    };
  } catch {
    _store = emptyStore();
  }
  return _store;
}

function scheduleWrite(): Promise<void> {
  _writeQueue = _writeQueue.then(async () => {
    const filePath = identityStoreFilePath();
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, JSON.stringify(getStore(), null, 2) + '\n', 'utf-8');
  });
  return _writeQueue;
}

function createPerson(now: string, displayName?: string): PersonIdentity {
  return {
    personId: `person_${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    displayName,
    channelKeys: [],
  };
}

/**
 * Resolve a channel-scoped identity to a person. Missing identities are created
 * automatically so every message has both `channelKey` and `personId` context.
 */
export async function resolveIdentity(
  channel: IdentityChannel,
  subject: string,
  options: { displayName?: string; personId?: string } = {},
): Promise<IdentityResolution> {
  const store = getStore();
  const channelKey = makeChannelKey(channel, subject);
  const now = new Date().toISOString();
  const existing = store.channelIdentities[channelKey];

  if (existing) {
    const person = store.people[existing.personId] ?? {
      personId: existing.personId,
      createdAt: existing.createdAt,
      updatedAt: now,
      channelKeys: [channelKey],
    };
    person.updatedAt = now;
    if (options.displayName) person.displayName = options.displayName;
    if (!person.channelKeys.includes(channelKey)) person.channelKeys.push(channelKey);
    store.people[person.personId] = person;
    existing.updatedAt = now;
    if (options.displayName) existing.displayName = options.displayName;
    await scheduleWrite();
    return { personId: person.personId, channelKey, identity: existing, person };
  }

  const personId = options.personId;
  let person = personId ? store.people[personId] : undefined;
  if (!person) person = createPerson(now, options.displayName);
  person.updatedAt = now;
  if (options.displayName) person.displayName = options.displayName;
  if (!person.channelKeys.includes(channelKey)) person.channelKeys.push(channelKey);
  store.people[person.personId] = person;

  const identity: ChannelIdentity = {
    channel: String(channel).trim().toLowerCase(),
    subject: String(subject).trim(),
    channelKey,
    personId: person.personId,
    createdAt: now,
    updatedAt: now,
    displayName: options.displayName,
  };
  store.channelIdentities[channelKey] = identity;
  await scheduleWrite();
  return { personId: person.personId, channelKey, identity, person };
}

/**
 * Link an additional channel identity to an existing person.
 */
export async function linkIdentity(
  personId: string,
  channel: IdentityChannel,
  subject: string,
  displayName?: string,
): Promise<IdentityResolution> {
  const store = getStore();
  if (!store.people[personId]) {
    const now = new Date().toISOString();
    store.people[personId] = { personId, createdAt: now, updatedAt: now, displayName, channelKeys: [] };
  }
  return resolveIdentity(channel, subject, { personId, displayName });
}

export function getPerson(personId: string): PersonIdentity | undefined {
  const person = getStore().people[personId];
  return person ? { ...person, channelKeys: [...person.channelKeys] } : undefined;
}

export function getIdentity(channel: IdentityChannel, subject: string): ChannelIdentity | undefined {
  const identity = getStore().channelIdentities[makeChannelKey(channel, subject)];
  return identity ? { ...identity } : undefined;
}

export function listPeople(): PersonIdentity[] {
  return Object.values(getStore().people).map((person) => ({ ...person, channelKeys: [...person.channelKeys] }));
}

export function personConversationKey(personId: string): string {
  return `person:${personId}`;
}

export async function resolveConversationKey(
  channel: IdentityChannel,
  subject: string,
  options: { displayName?: string } = {},
): Promise<{ channelKey: string; personId: string; conversationKey: string }> {
  const resolved = await resolveIdentity(channel, subject, options);
  return {
    channelKey: resolved.channelKey,
    personId: resolved.personId,
    conversationKey: personConversationKey(resolved.personId),
  };
}

/** Test helper: clear in-memory state so env-controlled file paths are re-read. */
export function _resetIdentityStoreForTests(): void {
  _store = null;
  _writeQueue = Promise.resolve();
}
