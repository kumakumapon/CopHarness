import type { SkillDefinition } from '../../core/skill';

import { randomNumber } from './utilities/randomNumber';
import { uuidGenerate } from './utilities/uuidGenerate';
import { base64Encode, base64Decode } from './utilities/base64';
import { jsonFormat } from './utilities/jsonFormat';
import { hashText } from './utilities/hashText';
import { regexMatch } from './utilities/regexMatch';
import { textStats } from './utilities/textStats';
import { credentialGeneratorSkill } from './utilities/generatePassword';
import { csvParse } from './utilities/csvParse';
import { diffText } from './utilities/diffText';
import { colorConvert } from './utilities/colorConvert';

import { getWeather } from './research/getWeather';
import { githubSearch } from './research/githubSearch';
import { rssFeed } from './research/rssFeed';
import { arXivSearch } from './research/arXivSearch';
import { deepResearch } from './research/deepResearch';
import { freeResearch } from './research/freeResearch';
import { techNews } from './research/techNews';
import { trendSearch } from './research/trendSearch';
import { newsBrief } from './research/newsBrief';
import { githubRepo } from './research/githubRepo';
import { youtubeInfo } from './research/youtubeInfo';

import { translateText } from './personal/translateText';
import { sendNotification } from './personal/sendNotification';
import { noteCreate, noteRead, noteList, noteDelete } from './personal/notes';

import { markdownToHtmlSkill } from './office/markdownToHtml';
import { createDocument } from './office/createDocument';
import { createSlideshow } from './office/createSlideshow';
import { createPresentation } from './office/createPresentation';

/** Skills this extension contributes, in registration order. */
export const builtinSkills: SkillDefinition[] = [
  // utilities
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
  diffText,
  colorConvert,
  // research
  getWeather,
  githubSearch,
  rssFeed,
  arXivSearch,
  deepResearch,
  freeResearch,
  techNews,
  trendSearch,
  newsBrief,
  githubRepo,
  youtubeInfo,
  // personal
  translateText,
  sendNotification,
  noteCreate,
  noteRead,
  noteList,
  noteDelete,
  // office
  markdownToHtmlSkill,
  createDocument,
  createSlideshow,
  createPresentation,
];
