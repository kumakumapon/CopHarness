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
import { memorySet, memoryGet, memoryList, memoryUpsert, memorySearch, memoryForget, memoryExplain } from './memory';

// Phase 6: external API
import { githubSearch } from './githubSearch';
import { translateText } from './translateText';
import { sendNotification } from './sendNotification';

// Phase 7: extended skills (inspired by karaage0703/ai-assistant-workspace)
import { rssFeed } from './rssFeed';
import { arXivSearch } from './arXivSearch';
import { deepResearch } from './deepResearch';
import { freeResearch } from './freeResearch';
import { techNews } from './techNews';
import { trendSearch } from './trendSearch';
import { newsBrief } from './newsBrief';
import { githubRepo } from './githubRepo';
import { youtubeInfo } from './youtubeInfo';
import { noteCreate, noteRead, noteList, noteDelete } from './notes';
import { markdownToHtmlSkill } from './markdownToHtml';
import { diffText } from './diffText';
import { colorConvert } from './colorConvert';

// Phase 8: document / presentation (inspired by OpenClaw SKILL.md & Hermes Agent pptxgenjs)
import { createDocument } from './createDocument';
import { createSlideshow } from './createSlideshow';
import { createPresentation } from './createPresentation';

// Prompt wizard
import { listPromptTemplates, buildPromptFromTemplate } from './promptWizard';

// Multi-agent
import { spawnAgent } from './spawnAgent';

// Phase 2: Skill proposal
import { proposeSkill } from './proposeSkill';

// Phase 2: conversation / task search
import { searchHistory } from './searchHistory';

// Human-in-the-loop gate
import { applyGatesToRegistry } from '../humanInLoop/gate';

// Generated skills loader
import { registerGeneratedSkills } from './generated';

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
  memoryUpsert,
  memorySearch,
  memoryForget,
  memoryExplain,
  githubSearch,
  translateText,
  sendNotification,
  arXivSearch,
  deepResearch,
  freeResearch,
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
  createDocument,
  createSlideshow,
  createPresentation,
  rssFeed,
  listPromptTemplates,
  buildPromptFromTemplate,
  spawnAgent,
  proposeSkill,
  searchHistory,
];

const gatedSkills = applyGatesToRegistry(allSkills);
for (const skill of gatedSkills) {
  registerSkill(skill);
}

// Register approved generated skills after built-ins so collision check sees them
try {
  registerGeneratedSkills();
} catch {
  // A corrupt proposal store must never break startup
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
  memoryUpsert,
  memorySearch,
  memoryForget,
  memoryExplain,
  githubSearch,
  translateText,
  sendNotification,
  arXivSearch,
  deepResearch,
  freeResearch,
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
  createDocument,
  createSlideshow,
  createPresentation,
  rssFeed,
  listPromptTemplates,
  buildPromptFromTemplate,
  spawnAgent,
  proposeSkill,
  searchHistory,
};
