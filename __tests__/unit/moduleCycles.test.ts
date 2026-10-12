/**
 * Guard against import cycles between lib/ modules (#163).
 *
 * A module is a directory under lib/core or an extension under lib/extensions; a file sitting
 * directly in lib/core (skill.ts, adapter.ts, ...) is its own module. Only runtime imports count.
 * Edges between the two layers are checked by moduleBoundaries.test.ts (core -> extensions is known debt
 * that would otherwise show up here as a cycle), so only edges inside one layer are considered.
 * If this test fails, a file sits in a directory whose other contents are in a different layer, or a
 * lower layer started importing a higher one. Move the file or invert the dependency.
 */
import { findCycles, libFileEdges, moduleOf } from '../fixtures/importGraph';

const layerOf = (module: string): string => module.split('/')[0];

describe('lib/ module layering', () => {
  it('has no runtime import cycles between modules', () => {
    const graph = new Map<string, Set<string>>();
    for (const { from, to } of libFileEdges()) {
      const a = moduleOf(from);
      const b = moduleOf(to);
      if (!graph.has(a)) graph.set(a, new Set());
      if (a !== b && layerOf(a) === layerOf(b)) graph.get(a)!.add(b);
    }
    expect(findCycles(graph)).toEqual([]);
  });
});
