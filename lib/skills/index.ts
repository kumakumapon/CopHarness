/**
 * Built-in skills registry.
 * Import this module to register all built-in skills.
 */

import { registerSkill } from '../skill';

// Phase 0: time
import { currentDateTime } from './currentDateTime';

// Phase 1: utility
import { calculator } from './calculator';
import { randomNumber } from './randomNumber';
import { uuidGenerate } from './uuidGenerate';
import { base64Encode, base64Decode } from './base64';
import { jsonFormat } from './jsonFormat';

// Phase 2: file
import { readFile } from './readFile';
import { writeFile } from './writeFile';
import { listDirectory } from './listDirectory';
import { searchInFiles } from './searchInFiles';

// Phase 3: web
import { fetchUrl } from './fetchUrl';
import { webSearch } from './webSearch';
import { getWeather } from './getWeather';

// Phase 4: system
import { runCommand } from './runCommand';
import { getSystemInfo } from './getSystemInfo';
import { getEnvVariable } from './getEnvVariable';

// Phase 5: memory
import { memorySet, memoryGet, memoryList } from './memory';

// Phase 6: external API
import { githubSearch } from './githubSearch';
import { translateText } from './translateText';
import { sendNotification } from './sendNotification';

const allSkills = [
  currentDateTime,
  calculator,
  randomNumber,
  uuidGenerate,
  base64Encode,
  base64Decode,
  jsonFormat,
  readFile,
  writeFile,
  listDirectory,
  searchInFiles,
  fetchUrl,
  webSearch,
  getWeather,
  runCommand,
  getSystemInfo,
  getEnvVariable,
  memorySet,
  memoryGet,
  memoryList,
  githubSearch,
  translateText,
  sendNotification,
];

for (const skill of allSkills) {
  registerSkill(skill);
}

export {
  currentDateTime,
  calculator,
  randomNumber,
  uuidGenerate,
  base64Encode,
  base64Decode,
  jsonFormat,
  readFile,
  writeFile,
  listDirectory,
  searchInFiles,
  fetchUrl,
  webSearch,
  getWeather,
  runCommand,
  getSystemInfo,
  getEnvVariable,
  memorySet,
  memoryGet,
  memoryList,
  githubSearch,
  translateText,
  sendNotification,
};
