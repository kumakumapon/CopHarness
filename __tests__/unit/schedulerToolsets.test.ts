/**
 * Tests for scheduler toolset integration.
 * Verifies that when a schedule has `toolsets`, runPrompt narrows the skill set.
 */

import '../../lib/skills/index';
import { resolveSkills, listActiveSkills } from '../../lib/skill';
import { resolveToolsetSkillNames, _resetToolsetsForTests } from '../../lib/skills/toolsets';

// ---------------------------------------------------------------------------
// We test the logic that runPrompt applies when toolsets are present:
//   skills = resolveSkills(resolveToolsetSkillNames(toolsets))
// This is the resolution path tested in isolation.
// ---------------------------------------------------------------------------

describe('scheduler toolset skill resolution', () => {
  beforeEach(() => {
    _resetToolsetsForTests();
  });

  afterEach(() => {
    _resetToolsetsForTests();
  });

  it('resolves research toolset to a subset of skills', () => {
    const toolsetSkillNames = resolveToolsetSkillNames(['research']);
    // Must be non-empty
    expect(toolsetSkillNames.length).toBeGreaterThan(0);
    // Should include webSearch if registered
    const allActive = listActiveSkills().map((s) => s.name);
    expect(toolsetSkillNames).toContain('webSearch');
    // Should be a strict subset of (or equal to) all registered skills
    const { listSkills } = require('../../lib/skill') as typeof import('../../lib/skill');
    const allRegistered = new Set(listSkills().map((s) => s.name));
    for (const name of toolsetSkillNames) {
      expect(allRegistered.has(name)).toBe(true);
    }
    void allActive; // suppress unused warning
  });

  it('resolveSkills narrows when toolset is specified vs all active', () => {
    // All active skills (no toolset restriction)
    const allActiveSkills = listActiveSkills();

    // Toolset-restricted skills (personal toolset)
    const toolsetNames = resolveToolsetSkillNames(['personal']);
    const toolsetSkills = resolveSkills(toolsetNames);

    // toolset skills should be fewer or equal, not more, than active skills
    // (some skills in 'personal' might not be in active set if they are medium/high risk
    //  and ENABLED_SKILLS is not set — in tests ENABLED_SKILLS is unset so
    //  only low-risk skills are resolved by default)
    expect(toolsetSkills.length).toBeLessThanOrEqual(allActiveSkills.length);
  });

  it('empty toolsets array falls through to listActiveSkills behavior', () => {
    const toolsetNames = resolveToolsetSkillNames([]);
    expect(toolsetNames).toEqual([]);
    // When empty, the engine uses listActiveSkills() — verify it returns non-empty
    const activeSkills = listActiveSkills();
    expect(activeSkills.length).toBeGreaterThan(0);
  });

  it('unknown toolset name warns and returns nothing', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const names = resolveToolsetSkillNames(['totally_unknown_toolset']);
    expect(names).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('totally_unknown_toolset'));
    warnSpy.mockRestore();
  });

  it('resolving two toolsets unions the skills', () => {
    const researchNames = resolveToolsetSkillNames(['research']);
    const personalNames = resolveToolsetSkillNames(['personal']);
    const combinedNames = resolveToolsetSkillNames(['research', 'personal']);

    // Combined must include all names from both individual resolves
    for (const name of researchNames) {
      expect(combinedNames).toContain(name);
    }
    for (const name of personalNames) {
      expect(combinedNames).toContain(name);
    }

    // Combined must be deduplicated
    const combinedSet = new Set(combinedNames);
    expect(combinedNames.length).toBe(combinedSet.size);
  });
});
