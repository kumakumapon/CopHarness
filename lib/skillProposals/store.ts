/**
 * SkillProposal store.
 *
 * Persists proposed generated skills through their lifecycle from draft to
 * registered, mirroring the pattern of lib/tasks/ledger.ts.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { dataPath } from '../utils/dataDir';
import { getSkill } from '../skill';
import {
  defaultGeneratedSkillManifest,
  normalizeGeneratedSkillManifest,
  validateGeneratedSkillManifest,
  type GeneratedSkillManifest,
} from './manifest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillProposalStatus =
  | 'draft'              // proposed, not yet tested
  | 'testing'            // sandbox tests running
  | 'tests_failed'       // sandbox tests failed
  | 'awaiting_approval'  // tests passed, waiting for human approval
  | 'approved'           // human approved, not yet registered
  | 'rejected'           // human rejected
  | 'registered';        // active as a generated skill

export interface SkillProposalTestCase {
  description?: string;
  args: Record<string, unknown>;
  expect?: { contains?: string; equals?: string; isError?: boolean };
}

export interface SkillProposalTestResult {
  index: number;
  passed: boolean;
  detail?: string;
}

export interface SkillProposal {
  id: string;
  name: string;
  description: string;
  problem: string;
  proposedCode: string;
  parameters?: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  testPlan: SkillProposalTestCase[];
  riskLevel: 'low' | 'medium' | 'high';
  status: SkillProposalStatus;
  approvalRequestId?: string;
  testResults?: SkillProposalTestResult[];
  personId?: string;
  channelKey?: string;
  taskId?: string;
  createdAt: string;
  updatedAt: string;
  errorPreview?: string;
  manifest: GeneratedSkillManifest;
  manifestHistory?: Array<{ manifest: GeneratedSkillManifest; changedAt: string }>;
}

// ---------------------------------------------------------------------------
// Internal file format
// ---------------------------------------------------------------------------

interface SkillProposalStoreFile {
  proposals: Record<string, SkillProposal>;
  order: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PROPOSALS = 500;

/** Statuses that count as "pending" — a proposal with one of these is still active. */
const PENDING_STATUSES = new Set<SkillProposalStatus>([
  'draft',
  'testing',
  'tests_failed',
  'awaiting_approval',
  'approved',
]);

const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{2,63}$/;

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

let _store: SkillProposalStoreFile | null = null;
let _writeQueue: Promise<void> = Promise.resolve();

// ---------------------------------------------------------------------------
// File path
// ---------------------------------------------------------------------------

function storeFilePath(): string {
  const explicit = process.env.SKILL_PROPOSAL_FILE;
  if (explicit) return path.resolve(explicit);
  return dataPath('skill_proposals.json');
}

// ---------------------------------------------------------------------------
// Load / trim / write
// ---------------------------------------------------------------------------

function emptyStore(): SkillProposalStoreFile {
  return { proposals: {}, order: [] };
}

function getStore(): SkillProposalStoreFile {
  if (_store) return _store;
  const filePath = storeFilePath();
  if (!fs.existsSync(filePath)) {
    _store = emptyStore();
    return _store;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<SkillProposalStoreFile>;
    const proposals =
      parsed.proposals && typeof parsed.proposals === 'object' ? parsed.proposals : {};
    for (const proposal of Object.values(proposals) as SkillProposal[]) {
      if (!proposal.manifest) {
        proposal.manifest = defaultGeneratedSkillManifest(proposal);
        proposal.manifestHistory = [{ manifest: proposal.manifest, changedAt: proposal.updatedAt ?? proposal.createdAt ?? new Date().toISOString() }];
      }
    }
    const order = Array.isArray(parsed.order)
      ? parsed.order.filter((id) => typeof id === 'string' && proposals[id])
      : Object.keys(proposals);
    _store = { proposals, order };
  } catch {
    _store = emptyStore();
  }
  return _store;
}

/**
 * Trim the store to MAX_PROPOSALS entries.
 * Drops oldest non-pending entries first; if still over limit, drops oldest entries.
 */
function trimStore(store: SkillProposalStoreFile): void {
  if (store.order.length <= MAX_PROPOSALS) return;

  // First pass: drop oldest non-pending entries
  const toRemove: string[] = [];
  for (const id of store.order) {
    if (store.order.length - toRemove.length <= MAX_PROPOSALS) break;
    const proposal = store.proposals[id];
    if (proposal && !PENDING_STATUSES.has(proposal.status)) {
      toRemove.push(id);
    }
  }

  for (const id of toRemove) {
    const idx = store.order.indexOf(id);
    if (idx !== -1) store.order.splice(idx, 1);
    delete store.proposals[id];
  }

  // Second pass: drop oldest entries regardless of status
  while (store.order.length > MAX_PROPOSALS) {
    const id = store.order.shift();
    if (id) delete store.proposals[id];
  }
}

function scheduleWrite(): Promise<void> {
  _writeQueue = _writeQueue.then(async () => {
    const filePath = storeFilePath();
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, JSON.stringify(getStore(), null, 2) + '\n', 'utf-8');
  });
  return _writeQueue;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export { type GeneratedSkillManifest } from './manifest';

function validateName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid skill name "${name}": must match /^[a-zA-Z][a-zA-Z0-9_]{2,63}$/ (start with a letter, 3–64 chars, letters/digits/underscores only)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type CreateSkillProposalInput = Omit<SkillProposal, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'manifest' | 'manifestHistory'> & {
  manifest?: Partial<GeneratedSkillManifest>;
};

export async function createSkillProposal(input: CreateSkillProposalInput): Promise<SkillProposal> {
  validateName(input.name);

  // Reject if name already registered as an active skill
  if (getSkill(input.name)) {
    throw new Error(
      `Cannot propose skill "${input.name}": a skill with this name is already registered.`,
    );
  }

  const store = getStore();

  // Reject duplicate pending proposals with the same name
  for (const id of store.order) {
    const existing = store.proposals[id];
    if (existing && existing.name === input.name && PENDING_STATUSES.has(existing.status)) {
      throw new Error(
        `A pending proposal for skill "${input.name}" already exists (id: ${id}, status: ${existing.status}). Resolve or reject it before creating a new one.`,
      );
    }
  }

  const now = new Date().toISOString();
  const id = `proposal-${randomUUID()}`;

  const manifest = normalizeGeneratedSkillManifest(input.manifest, { name: input.name, riskLevel: input.riskLevel });
  if (manifest.name !== input.name) {
    throw new Error(`Generated skill manifest name "${manifest.name}" must match proposal name "${input.name}".`);
  }
  if (manifest.riskLevel !== input.riskLevel) {
    throw new Error(`Generated skill manifest riskLevel "${manifest.riskLevel}" must match proposal riskLevel "${input.riskLevel}".`);
  }
  validateGeneratedSkillManifest(manifest);

  const proposal: SkillProposal = {
    ...input,
    manifest,
    manifestHistory: [{ manifest, changedAt: now }],
    id,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };

  store.proposals[id] = proposal;
  store.order.push(id);
  trimStore(store);
  await scheduleWrite();

  return { ...proposal };
}

export async function updateSkillProposal(
  id: string,
  patch: Partial<Omit<SkillProposal, 'id' | 'createdAt' | 'manifest'>> & { manifest?: Partial<GeneratedSkillManifest> },
): Promise<SkillProposal | undefined> {
  const store = getStore();
  const existing = store.proposals[id];
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const manifest = patch.manifest
    ? normalizeGeneratedSkillManifest(patch.manifest, { name: patch.name ?? existing.name, riskLevel: patch.riskLevel ?? existing.riskLevel })
    : existing.manifest ?? defaultGeneratedSkillManifest(existing);
  validateGeneratedSkillManifest(manifest);

  const manifestChanged = JSON.stringify(manifest) !== JSON.stringify(existing.manifest);
  const updated: SkillProposal = {
    ...existing,
    ...patch,
    manifest,
    manifestHistory: manifestChanged
      ? [...(existing.manifestHistory ?? []), { manifest, changedAt: now }]
      : existing.manifestHistory,
    id,
    createdAt: existing.createdAt,
    updatedAt: now,
  };

  store.proposals[id] = updated;
  await scheduleWrite();
  return { ...updated };
}

export function getSkillProposal(id: string): SkillProposal | undefined {
  const proposal = getStore().proposals[id];
  return proposal ? { ...proposal } : undefined;
}

/** Return the most-recently-created proposal with the given name, or undefined. */
export function getSkillProposalByName(name: string): SkillProposal | undefined {
  const store = getStore();
  // order is oldest→newest; iterate in reverse to find most recent
  for (let i = store.order.length - 1; i >= 0; i--) {
    const proposal = store.proposals[store.order[i]];
    if (proposal && proposal.name === name) return { ...proposal };
  }
  return undefined;
}

export function listSkillProposals(limit = 50): SkillProposal[] {
  return querySkillProposals({ limit }).proposals;
}

export interface SkillProposalQueryOptions {
  status?: SkillProposalStatus;
  nameQuery?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  limit?: number;
}

export function querySkillProposals(
  options: SkillProposalQueryOptions = {},
): { proposals: SkillProposal[]; total: number } {
  const store = getStore();
  const limit = Math.max(1, Math.min(options.limit ?? 50, MAX_PROPOSALS));
  const nameQuery = options.nameQuery?.trim().toLowerCase() || undefined;

  const filtered = store.order
    .slice()
    .reverse()
    .map((id) => store.proposals[id])
    .filter(Boolean)
    .filter((p) => {
      if (options.status && p.status !== options.status) return false;
      if (options.riskLevel && p.riskLevel !== options.riskLevel) return false;
      if (nameQuery && !p.name.toLowerCase().includes(nameQuery)) return false;
      return true;
    });

  return {
    proposals: filtered.slice(0, limit).map((p) => ({ ...p })),
    total: filtered.length,
  };
}

/** Test helper: clear in-memory state so env-controlled file paths are re-read. */
export function _resetSkillProposalsForTests(): void {
  _store = null;
  _writeQueue = Promise.resolve();
}
