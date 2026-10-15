import * as fs from 'fs';
import * as path from 'path';
import '../../lib/bootstrap';
import { listSkills } from '../../lib/core/skill';

/**
 * README / SKILLS_GUIDE must only advertise skills that are actually registered
 * (they once documented memorySet/Get/List after those stopped being registered).
 */
const ROOT = path.resolve(__dirname, '..', '..');
const DOCS = ['README.md', path.join('docs', 'SKILLS_GUIDE.md')];

function readDoc(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf-8');
}

/**
 * Skill names from tables whose header starts with "スキル名" (optionally after "カテゴリ"). Rows look like "| `skill` | ...",
 * "| **Group** | `skill` | ..." or "| | `skill` | ...".
 */
function tableSkillNames(text: string): string[] {
  const names: string[] = [];
  let inSkillTable = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|')) {
      inSkillTable = false;
      continue;
    }
    if (/^\|\s*(?:カテゴリ\s*\|\s*)?スキル名\s*\|/.test(line)) {
      inSkillTable = true;
      continue;
    }
    if (!inSkillTable) continue;
    const m = /^\|\s*(?:(?:\*\*[^|]*\*\*)?\s*\|\s*)?`([A-Za-z][A-Za-z0-9]*)`\s*\|/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

function enabledSkillsExamples(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/^ENABLED_SKILLS=([^\s#]+)/gm)) names.push(...m[1].split(','));
  return names.filter(name => Boolean(name) && name !== 'none');
}

describe('documented skill names exist in the registry', () => {
  const registered = new Set(listSkills().map((s) => s.name));

  it.each(DOCS)('%s: ENABLED_SKILLS examples only name registered skills', (file) => {
    const unknown = enabledSkillsExamples(readDoc(file)).filter((n) => !registered.has(n));
    expect(unknown).toEqual([]);
  });

  it.each(DOCS)('%s: skill tables only list registered skills', (file) => {
    const candidates = tableSkillNames(readDoc(file));
    expect(candidates.length).toBeGreaterThan(20);
    expect(candidates.filter((n) => !registered.has(n))).toEqual([]);
  });

  it('every registered memory skill is documented', () => {
    for (const file of DOCS) {
      const text = readDoc(file);
      for (const name of registered) {
        if (name.startsWith('memory')) expect(text).toContain(`\`${name}\``);
      }
    }
  });
});
