/**
 * Persistent key-value memory for skills.
 * Data is stored in a JSON file (SKILL_MEMORY_FILE, default: ./memory.json).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { type SkillDefinition } from '../skill';

function getMemoryFile(): string {
  const raw = process.env.SKILL_MEMORY_FILE ?? './memory.json';
  return path.resolve(raw);
}

async function loadMemory(): Promise<Record<string, string>> {
  const file = getMemoryFile();
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function saveMemory(data: Record<string, string>): Promise<void> {
  const file = getMemoryFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

export const memorySet: SkillDefinition = {
  name: 'memorySet',
  description:
    'Saves a key-value pair to persistent memory (stored in SKILL_MEMORY_FILE, default: ./memory.json). ' +
    'Use this to remember information across conversations.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'The key to store the value under.' },
      value: { type: 'string', description: 'The value to store.' },
    },
    required: ['key', 'value'],
  },
  category: 'memory',
  riskLevel: 'medium',
  handler: async (args) => {
    const key = String(args.key ?? '').trim();
    const value = String(args.value ?? '');
    if (!key) return { content: 'Error: key is required', isError: true };
    try {
      const data = await loadMemory();
      data[key] = value;
      await saveMemory(data);
      return { content: `Saved: "${key}" = "${value}"` };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const memoryGet: SkillDefinition = {
  name: 'memoryGet',
  description: 'Retrieves the value stored under a key from persistent memory.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'The key to look up.' },
    },
    required: ['key'],
  },
  category: 'memory',
  riskLevel: 'low',
  handler: async (args) => {
    const key = String(args.key ?? '').trim();
    if (!key) return { content: 'Error: key is required', isError: true };
    try {
      const data = await loadMemory();
      if (!(key in data)) return { content: `(no value stored for key "${key}")` };
      return { content: data[key] };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const memoryList: SkillDefinition = {
  name: 'memoryList',
  description: 'Lists all keys and their values stored in persistent memory.',
  parameters: {
    type: 'object',
    properties: {},
  },
  category: 'memory',
  riskLevel: 'low',
  handler: async () => {
    try {
      const data = await loadMemory();
      const keys = Object.keys(data);
      if (keys.length === 0) return { content: '(memory is empty)' };
      const lines = keys.map((k) => `"${k}": "${data[k]}"`);
      return { content: lines.join('\n') };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
