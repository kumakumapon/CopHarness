/**
 * Runtime import graph of lib/, shared by the layering tests (#163).
 * Only runtime imports count: `import type` is erased and cannot create a load-time dependency.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

export const ROOT = path.resolve(__dirname, '..', '..');
export const LIB = path.join(ROOT, 'lib');

function listSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSources(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
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

const posix = (file: string): string => path.relative(ROOT, file).split(path.sep).join('/');

/** Every runtime import between two files under lib/, as repo-relative posix paths. */
export function libFileEdges(): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const file of listSources(LIB)) {
    for (const spec of runtimeImports(file)) {
      const target = resolveInLib(file, spec);
      if (target) edges.push({ from: posix(file), to: posix(target) });
    }
  }
  return edges;
}

/**
 * The unit the cycle check works on: `core/<dir>` or `extensions/<name>`; a file sitting directly
 * in core/ (skill.ts, adapter.ts, ...) is its own unit.
 */
export function moduleOf(repoPath: string): string {
  const parts = repoPath.replace(/^lib\//, '').split('/');
  if (parts[0] === 'core') return `core/${parts[1]}`;
  if (parts[0] === 'extensions') return `extensions/${parts[1]}`;
  return parts[0];
}

/** Strongly connected groups with more than one member (Tarjan). */
export function findCycles(graph: Map<string, Set<string>>): string[][] {
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
