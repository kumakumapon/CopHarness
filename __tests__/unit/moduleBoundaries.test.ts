/**
 * Core / extension boundary (#163).
 *
 * - `lib/core` is the part that must work on its own (CLI + HTTP: model call, skill registry,
 *   tool policy, approval gate). It must not import from `lib/extensions`.
 * - An extension may import `lib/core` freely, but another extension only where it is declared below.
 *
 * KNOWN_CORE_TO_EXTENSION is the list of violations that still exist. It may only shrink: removing a
 * dependency without deleting its line here fails the test too, so the list cannot go stale.
 *   - skills/index.ts registers extension skills directly -> each extension should register its own.
 *   - adapterFactory.ts wraps adapters with telemetry/cache -> they should register as decorators.
 */
import { libFileEdges } from '../fixtures/importGraph';

const KNOWN_CORE_TO_EXTENSION = [
  'lib/core/adapterFactory.ts -> lib/extensions/cache/cachedAdapter.ts',
  'lib/core/adapterFactory.ts -> lib/extensions/cache/responseCache.ts',
  'lib/core/adapterFactory.ts -> lib/extensions/telemetry/instrumentedAdapter.ts',
  'lib/core/skills/index.ts -> lib/extensions/agents/spawnAgent.ts',
  'lib/core/skills/index.ts -> lib/extensions/memory/skills/memory.ts',
  'lib/core/skills/index.ts -> lib/extensions/memory/skills/searchHistory.ts',
  'lib/core/skills/index.ts -> lib/extensions/prompt-wizard/promptWizard.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/office/createDocument.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/office/createPresentation.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/office/createSlideshow.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/office/markdownToHtml.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/personal/notes.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/personal/sendNotification.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/personal/translateText.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/research/arXivSearch.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/research/deepResearch.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/research/freeResearch.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/research/getWeather.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/research/githubRepo.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/research/githubSearch.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/research/newsBrief.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/research/rssFeed.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/research/techNews.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/research/trendSearch.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/research/youtubeInfo.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/utilities/base64.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/utilities/colorConvert.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/utilities/csvParse.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/utilities/diffText.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/utilities/generatePassword.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/utilities/hashText.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/utilities/jsonFormat.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/utilities/randomNumber.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/utilities/regexMatch.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/utilities/textStats.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-packs/utilities/uuidGenerate.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-proposals/generated/index.ts',
  'lib/core/skills/index.ts -> lib/extensions/skill-proposals/proposeSkill.ts',
];

/** "from -> to" extension dependencies that are allowed today. */
const DECLARED_EXTENSION_DEPENDENCIES = [
  'agents -> tasks',
  'automation -> agents',
  'automation -> tasks',
  'channels -> tasks',
  'conversations -> memory',
  'dashboard -> agents',
  'dashboard -> tasks',
  'skill-packs -> memory',
  'tasks -> memory',
];

const extensionOf = (file: string): string | null => {
  const match = /^lib\/extensions\/([^/]+)\//.exec(file);
  return match ? match[1] : null;
};

describe('core / extension boundary', () => {
  const edges = libFileEdges();

  it('lib/core imports lib/extensions only where listed as known debt', () => {
    const actual = edges
      .filter(({ from, to }) => from.startsWith('lib/core/') && to.startsWith('lib/extensions/'))
      .map(({ from, to }) => `${from} -> ${to}`);
    expect([...new Set(actual)].sort()).toEqual([...KNOWN_CORE_TO_EXTENSION].sort());
  });

  it('extensions depend on each other only where declared', () => {
    const actual = edges
      .map(({ from, to }) => [extensionOf(from), extensionOf(to)] as const)
      .filter(([a, b]) => a && b && a !== b)
      .map(([a, b]) => `${a} -> ${b}`);
    expect([...new Set(actual)].sort()).toEqual([...DECLARED_EXTENSION_DEPENDENCIES].sort());
  });
});
