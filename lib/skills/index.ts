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
import { hashText } from './hashText';
import { regexMatch } from './regexMatch';
import { textStats } from './textStats';
import { generatePassword } from './generatePassword';
import { csvParse } from './csvParse';

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

// Phase 7: extended skills (inspired by karaage0703/ai-assistant-workspace)
import { arXivSearch } from './arXivSearch';
import { techNews } from './techNews';
import { trendSearch } from './trendSearch';
import { newsBrief } from './newsBrief';
import { githubRepo } from './githubRepo';
import { youtubeInfo } from './youtubeInfo';
import { noteCreate, noteRead, noteList, noteDelete } from './notes';
import { markdownToHtmlSkill } from './markdownToHtml';
import { diffText } from './diffText';
import { colorConvert } from './colorConvert';

const allSkills = [
  currentDateTime,
  calculator,
  randomNumber,
  uuidGenerate,
  base64Encode,
  base64Decode,
  jsonFormat,
  hashText,
  regexMatch,
  textStats,
  generatePassword,
  csvParse,
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
  arXivSearch,
  techNews,
  trendSearch,
  newsBrief,
  githubRepo,
  youtubeInfo,
  noteCreate,
  noteRead,
  noteList,
  noteDelete,
  markdownToHtmlSkill,
  diffText,
  colorConvert,
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
  hashText,
  regexMatch,
  textStats,
  generatePassword,
  csvParse,
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
  arXivSearch,
  techNews,
  trendSearch,
  newsBrief,
  githubRepo,
  youtubeInfo,
  noteCreate,
  noteRead,
  noteList,
  noteDelete,
  markdownToHtmlSkill,
  diffText,
  colorConvert,
};
