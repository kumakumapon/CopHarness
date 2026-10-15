import { isMinimalRuntime } from '../runtimeProfile';
/**
 * Core skills registry.
 * Importing this module registers the skills the core needs on its own: time, calculator, files,
 * web, and system. Extensions register their own skills (see lib/bootstrap.ts).
 */

import { currentDateTime } from './currentDateTime';
import { calculator } from './calculator';
import { readFile } from './readFile';
import { writeFile } from './writeFile';
import { listDirectory } from './listDirectory';
import { searchInFiles } from './searchInFiles';
import { fetchUrl } from './fetchUrl';
import { webSearch } from './webSearch';
import { runCommand } from './runCommand';
import { getSystemInfo } from './getSystemInfo';
import { getEnvVariable } from './getEnvVariable';
import { registerSkillSet } from './registerSkillSet';

const coreSkills = [
  currentDateTime,
  calculator,
  readFile,
  writeFile,
  listDirectory,
  searchInFiles,
  fetchUrl,
  webSearch,
  runCommand,
  getSystemInfo,
  getEnvVariable,
];

if (isMinimalRuntime()) {
  const selected = (process.env.ENABLED_SKILLS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const unknown = selected.filter(name => name !== 'none' && !coreSkills.some(skill => skill.name === name));
  if (unknown.length) throw new Error(`Minimal profile supports core skills only: ${unknown.join(', ')}`);
  registerSkillSet(coreSkills.filter(skill => selected.includes(skill.name)));
} else {
  registerSkillSet(coreSkills);
}
