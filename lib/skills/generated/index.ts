/**
 * Generated skills loader.
 *
 * Registers all approved/registered generated skill proposals into the skill
 * registry at startup. Called after built-in skills so collision detection
 * against built-ins works correctly.
 */

import { registerApprovedGeneratedSkills } from '../../skillProposals/lifecycle';

export function registerGeneratedSkills(): void {
  try {
    const { registered, skipped } = registerApprovedGeneratedSkills();
    if (registered.length > 0 || skipped.length > 0) {
      console.info(
        `[GeneratedSkills] Registered ${registered.length} generated skill(s)` +
          (skipped.length > 0 ? `, skipped ${skipped.length} already-registered.` : '.'),
      );
    }
  } catch (err) {
    // A corrupt proposal store must never break startup
    console.error('[GeneratedSkills] Failed to load generated skills:', err);
  }
}
