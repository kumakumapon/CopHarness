/**
 * Built-in skills registry.
 * Import this module to register all built-in skills.
 */

import { registerSkill } from '../skill';

// Phase 0: time
import { currentDateTime } from './currentDateTime';

// Phase 1: utility
import { calculator } from './calculator';
import { randomNumber } from '../../extensions/skill-packs/utilities/randomNumber';
import { uuidGenerate } from '../../extensions/skill-packs/utilities/uuidGenerate';
import { base64Encode, base64Decode } from '../../extensions/skill-packs/utilities/base64';
import { jsonFormat } from '../../extensions/skill-packs/utilities/jsonFormat';
import { hashText } from '../../extensions/skill-packs/utilities/hashText';
import { regexMatch } from '../../extensions/skill-packs/utilities/regexMatch';
import { textStats } from '../../extensions/skill-packs/utilities/textStats';
import { credentialGeneratorSkill } from '../../extensions/skill-packs/utilities/generatePassword';
import { csvParse } from '../../extensions/skill-packs/utilities/csvParse';

// Phase 2: file
import { readFile } from './readFile';
import { writeFile } from './writeFile';
import { listDirectory } from './listDirectory';
import { searchInFiles } from './searchInFiles';

// Phase 3: web
import { fetchUrl } from './fetchUrl';
import { webSearch } from './webSearch';
import { getWeather } from '../../extensions/skill-packs/research/getWeather';

// Phase 4: system
import { runCommand } from './runCommand';
import { getSystemInfo } from './getSystemInfo';
import { getEnvVariable } from './getEnvVariable';

// Phase 5: memory
import { memoryUpsert, memorySearch, memoryForget, memoryExplain } from '../../extensions/memory/skills/memory';

// Phase 6: external API
import { githubSearch } from '../../extensions/skill-packs/research/githubSearch';
import { translateText } from '../../extensions/skill-packs/personal/translateText';
import { sendNotification } from '../../extensions/skill-packs/personal/sendNotification';

// Phase 7: extended skills (inspired by karaage0703/ai-assistant-workspace)
import { rssFeed } from '../../extensions/skill-packs/research/rssFeed';
import { arXivSearch } from '../../extensions/skill-packs/research/arXivSearch';
import { deepResearch } from '../../extensions/skill-packs/research/deepResearch';
import { freeResearch } from '../../extensions/skill-packs/research/freeResearch';
import { techNews } from '../../extensions/skill-packs/research/techNews';
import { trendSearch } from '../../extensions/skill-packs/research/trendSearch';
import { newsBrief } from '../../extensions/skill-packs/research/newsBrief';
import { githubRepo } from '../../extensions/skill-packs/research/githubRepo';
import { youtubeInfo } from '../../extensions/skill-packs/research/youtubeInfo';
import { noteCreate, noteRead, noteList, noteDelete } from '../../extensions/skill-packs/personal/notes';
import { markdownToHtmlSkill } from '../../extensions/skill-packs/office/markdownToHtml';
import { diffText } from '../../extensions/skill-packs/utilities/diffText';
import { colorConvert } from '../../extensions/skill-packs/utilities/colorConvert';

// Phase 8: document / presentation (inspired by OpenClaw SKILL.md & Hermes Agent pptxgenjs)
import { createDocument } from '../../extensions/skill-packs/office/createDocument';
import { createSlideshow } from '../../extensions/skill-packs/office/createSlideshow';
import { createPresentation } from '../../extensions/skill-packs/office/createPresentation';

// Prompt wizard
import { listPromptTemplates, buildPromptFromTemplate } from '../../extensions/prompt-wizard/promptWizard';

// Multi-agent
import { spawnAgent } from '../../extensions/agents/spawnAgent';

// Phase 2: Skill proposal
import { proposeSkill } from '../../extensions/skill-proposals/proposeSkill';

// Phase 2: conversation / task search
import { searchHistory } from '../../extensions/memory/skills/searchHistory';

// Human-in-the-loop gate
import { applyGatesToRegistry } from '../humanInLoop/gate';

// Generated skills loader
import { registerGeneratedSkills } from '../../extensions/skill-proposals/generated';

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
  credentialGeneratorSkill,
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
} catch (err) {
  console.error('[skills] Failed to register generated skills:', err instanceof Error ? err.message : err);
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
  credentialGeneratorSkill as generatePassword,
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
