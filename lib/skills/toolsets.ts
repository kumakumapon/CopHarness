/**
 * Toolset / MCP Hub — toolset definitions.
 *
 * A toolset is a named collection of skill-name patterns (supporting a simple
 * glob: `*` wildcard anywhere).  Built-in toolsets ship with the harness;
 * custom toolsets are loaded from DATA_DIR/toolsets.json (or TOOLSETS_FILE).
 */

import * as fs from 'fs';
import * as path from 'path';
import { dataPath } from '../utils/dataDir';
import { listSkills } from '../skill';

export interface ToolsetDefinition {
  name: string;
  description: string;
  skills: string[];
  source: 'builtin' | 'custom';
}

// ---------------------------------------------------------------------------
// Glob matcher — `*` wildcard anywhere in the pattern
// ---------------------------------------------------------------------------

export function matchesGlob(pattern: string, name: string): boolean {
  if (!pattern.includes('*')) return pattern === name;
  // Escape regex special chars except `*`, then replace `*` with `.*`
  const regexStr = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${regexStr}$`).test(name);
}

// ---------------------------------------------------------------------------
// Built-in toolsets
// NOTE: skill names verified against lib/skills/index.ts registrations.
// ---------------------------------------------------------------------------

const BUILTIN_TOOLSETS: ToolsetDefinition[] = [
  {
    name: 'research',
    description: 'Web search, RSS, arXiv, news, trend and deep-research skills plus history/memory search.',
    source: 'builtin',
    skills: [
      'webSearch',
      'fetchUrl',
      'rssFeed',
      'arXivSearch',
      'deepResearch',
      'freeResearch',
      'techNews',
      'trendSearch',
      'newsBrief',
      'youtubeInfo',
      'searchHistory',
      'memorySearch',
    ],
  },
  {
    name: 'coding',
    description: 'File I/O, search, command execution, GitHub and diff/markup skills.',
    source: 'builtin',
    skills: [
      'readFile',
      'writeFile',
      'listDirectory',
      'searchInFiles',
      'runCommand',
      'githubSearch',
      'githubRepo',
      'diffText',
      'markdownToHtmlSkill',
    ],
  },
  {
    name: 'office',
    description: 'Document, slideshow and presentation creation, calculator, CSV and translation.',
    source: 'builtin',
    skills: [
      'createDocument',
      'createSlideshow',
      'createPresentation',
      'calculator',
      'csvParse',
      'translateText',
    ],
  },
  {
    name: 'personal',
    description: 'Memory management, notes, weather, date/time, notifications.',
    source: 'builtin',
    skills: [
      'memorySet',
      'memoryGet',
      'memoryList',
      'memoryUpsert',
      'memorySearch',
      'memoryForget',
      'memoryExplain',
      'noteCreate',
      'noteRead',
      'noteList',
      'noteDelete',
      'getWeather',
      'currentDateTime',
      'sendNotification',
    ],
  },
  {
    name: 'dangerous',
    description: 'High-risk system skills: command execution, file writes, env access, agent spawning.',
    source: 'builtin',
    skills: [
      'runCommand',
      'writeFile',
      'getEnvVariable',
      'spawnAgent',
      'getSystemInfo',
    ],
  },
];

// ---------------------------------------------------------------------------
// Custom toolsets store (toolsets.json)
// ---------------------------------------------------------------------------

interface ToolsetsFile {
  version: number;
  toolsets: Array<{ name: string; description?: string; skills: string[] }>;
}

function toolsetsFilePath(): string {
  return process.env.TOOLSETS_FILE
    ? path.resolve(process.env.TOOLSETS_FILE)
    : dataPath('toolsets.json');
}

let _customToolsets: ToolsetDefinition[] | null = null;
let _warnedInvalidFile = false;

function loadCustomToolsets(): ToolsetDefinition[] {
  if (_customToolsets !== null) return _customToolsets;

  const p = toolsetsFilePath();
  if (!fs.existsSync(p)) {
    _customToolsets = [];
    return _customToolsets;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as Partial<ToolsetsFile>;
    if (!Array.isArray(parsed.toolsets)) throw new Error('toolsets must be an array');
    _customToolsets = parsed.toolsets.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      skills: Array.isArray(t.skills) ? t.skills : [],
      source: 'custom' as const,
    }));
  } catch (err) {
    if (!_warnedInvalidFile) {
      console.warn('[Toolsets] Invalid toolsets.json — ignoring custom toolsets:', err);
      _warnedInvalidFile = true;
    }
    _customToolsets = [];
  }

  return _customToolsets;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return all toolsets: built-ins merged with custom ones.
 * A custom toolset with the same name overrides the built-in.
 */
export function listToolsets(): ToolsetDefinition[] {
  const custom = loadCustomToolsets();
  const customNames = new Set(custom.map((t) => t.name));
  const base = BUILTIN_TOOLSETS.filter((t) => !customNames.has(t.name));
  return [...base, ...custom];
}

/** Look up a single toolset by name. */
export function getToolset(name: string): ToolsetDefinition | undefined {
  return listToolsets().find((t) => t.name === name);
}

/**
 * Resolve a list of toolset names to actual registered skill names.
 * - Unknown toolset names are skipped with a console.warn.
 * - Skill patterns are matched (glob) against registered skill names.
 * - Result is deduped.
 */
export function resolveToolsetSkillNames(toolsetNames: string[]): string[] {
  const registeredNames = new Set(listSkills().map((s) => s.name));
  const resolved = new Set<string>();

  for (const toolsetName of toolsetNames) {
    const toolset = getToolset(toolsetName);
    if (!toolset) {
      console.warn(`[Toolsets] Unknown toolset "${toolsetName}" — skipping`);
      continue;
    }
    for (const pattern of toolset.skills) {
      for (const skillName of registeredNames) {
        if (matchesGlob(pattern, skillName)) {
          resolved.add(skillName);
        }
      }
    }
  }

  return Array.from(resolved);
}

/** Reset cached state — for use in tests only. */
export function _resetToolsetsForTests(): void {
  _customToolsets = null;
  _warnedInvalidFile = false;
}
