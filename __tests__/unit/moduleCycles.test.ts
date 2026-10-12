/**
 * Guard against import cycles between lib/ modules (#163).
 *
 * A module is a directory directly under lib/ (lib/skills, lib/tasks, ...); a file sitting
 * directly in lib/ is its own module. Only runtime imports count: `import type` is erased.
 * If this test fails, a file was put in a directory whose other contents sit in a different
 * layer, or a lower layer started importing a higher one. Move the file or invert the dependency.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const LIB = path.resolve(__dirname, '..', '..', 'lib');

function listSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSources(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

function moduleOf(file: string): string {
  const parts = path.relative(LIB, file).split(path.sep);
  return parts.length === 1 ? parts[0].replace(/\.tsx?$/, '') + '.ts' : parts[0];
}

function runtimeImports(file: string): string[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true);
  const specs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.importClause?.isTypeOnly) specs.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) specs.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) {
        specs.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specs;
}

function resolveInLib(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (candidate.startsWith(LIB + path.sep) && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findCycles(graph: Map<string, Set<string>>): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  const connect = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        connect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const group: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        group.push(w);
      } while (w !== v);
      if (group.length > 1) cycles.push(group.sort());
    }
  };

  for (const v of graph.keys()) if (!index.has(v)) connect(v);
  return cycles;
}

describe('lib/ module layering', () => {
  it('has no runtime import cycles between modules', () => {
    const graph = new Map<string, Set<string>>();
    for (const file of listSources(LIB)) {
      const from = moduleOf(file);
      if (!graph.has(from)) graph.set(from, new Set());
      for (const spec of runtimeImports(file)) {
        const target = resolveInLib(file, spec);
        if (!target) continue;
        const to = moduleOf(target);
        if (to !== from) graph.get(from)!.add(to);
      }
    }
    expect(findCycles(graph)).toEqual([]);
  });
});
