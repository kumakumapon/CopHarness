/**
 * Core / extension boundary (#163).
 *
 * - `lib/core` is the part that must work on its own (CLI + HTTP: model call, skill registry,
 *   tool policy, approval gate). It must not import from `lib/extensions`.
 * - An extension may import `lib/core` freely, but another extension only where it is declared below.
 *
 * KNOWN_CORE_TO_EXTENSION is the list of violations that still exist. It may only shrink: removing a
 * dependency without deleting its line here fails the test too, so the list cannot go stale.
 *   - adapterFactory.ts wraps adapters with telemetry/cache -> they should register as decorators.
 *
 * lib/bootstrap.ts is the composition root (it registers every extension's skills). Library code should not
 * import it; the only exception is listed below until entry points call it explicitly.
 */
import { libFileEdges } from '../fixtures/importGraph';

const KNOWN_CORE_TO_EXTENSION = [
  'lib/core/adapterFactory.ts -> lib/extensions/cache/cachedAdapter.ts',
  'lib/core/adapterFactory.ts -> lib/extensions/cache/responseCache.ts',
  'lib/core/adapterFactory.ts -> lib/extensions/telemetry/instrumentedAdapter.ts',
];

/** Files under lib/ that may import the composition root (lib/bootstrap.ts). */
const BOOTSTRAP_IMPORTERS = ['lib/extensions/automation/scheduler/engine.ts'];

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

  it('only the listed library files import the composition root', () => {
    const importers = edges.filter(({ to }) => to === 'lib/bootstrap.ts').map(({ from }) => from);
    expect([...new Set(importers)].sort()).toEqual([...BOOTSTRAP_IMPORTERS].sort());
  });
});
