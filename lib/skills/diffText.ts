import { type SkillDefinition } from '../skill';

/**
 * Text diff skill — compare two texts and show line-by-line differences.
 * No external dependencies; uses a simple LCS-based diff algorithm.
 */

/** Compute the LCS (Longest Common Subsequence) table for two arrays. */
function buildLcs(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  // Use two-row rolling array to save memory
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);
  // Store full table for backtracking
  const table: number[][] = [prev.slice()];
  for (let i = 1; i <= m; i++) {
    curr = new Array<number>(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    table.push(curr.slice());
    prev = curr;
  }
  return table;
}

interface DiffLine {
  type: 'equal' | 'add' | 'remove';
  line: string;
}

/** Produce a line-level diff between two texts. */
function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const table = buildLcs(a, b);
  const result: DiffLine[] = [];

  let i = a.length;
  let j = b.length;
  const ops: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: 'equal', line: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || (table[i][j - 1] ?? 0) >= (table[i - 1]?.[j] ?? 0))) {
      ops.push({ type: 'add', line: b[j - 1] });
      j--;
    } else {
      ops.push({ type: 'remove', line: a[i - 1] });
      i--;
    }
  }

  return ops.reverse();
}

export const diffText: SkillDefinition = {
  name: 'diffText',
  description:
    'Compares two texts line-by-line and shows the differences in a unified diff format. ' +
    'Lines starting with "+" are additions, "-" are removals, and " " are unchanged. ' +
    'Useful for comparing code snippets, document versions, or any two pieces of text.',
  parameters: {
    type: 'object',
    properties: {
      oldText: {
        type: 'string',
        description: 'The original (old) text.',
      },
      newText: {
        type: 'string',
        description: 'The new (modified) text.',
      },
      contextLines: {
        type: 'number',
        description: 'Number of unchanged context lines to show around each change (0–10). Defaults to 3.',
        minimum: 0,
        maximum: 10,
      },
    },
    required: ['oldText', 'newText'],
  },
  category: 'utility',
  riskLevel: 'low',
  handler: async (args) => {
    const oldText = String(args.oldText ?? '');
    const newText = String(args.newText ?? '');
    const context = typeof args.contextLines === 'number'
      ? Math.min(10, Math.max(0, Math.floor(args.contextLines)))
      : 3;

    if (oldText === newText) {
      return { content: '(no differences — the texts are identical)' };
    }

    try {
      const diff = diffLines(oldText, newText);

      // Build compact output with context
      const outputLines: string[] = [];
      let additions = 0;
      let deletions = 0;

      // Identify changed line indices
      const changedIdx = new Set<number>();
      for (let i = 0; i < diff.length; i++) {
        if (diff[i].type !== 'equal') changedIdx.add(i);
      }

      // Expand context around changes
      const showIdx = new Set<number>();
      for (const idx of changedIdx) {
        for (let c = Math.max(0, idx - context); c <= Math.min(diff.length - 1, idx + context); c++) {
          showIdx.add(c);
        }
      }

      let lastShown = -1;
      for (let i = 0; i < diff.length; i++) {
        const entry = diff[i];
        if (!showIdx.has(i)) {
          if (lastShown !== -1 && i > lastShown + 1) {
            // Already printed separator
          }
          continue;
        }
        if (lastShown !== -1 && i > lastShown + 1) {
          outputLines.push(`@@ ... @@`);
        }
        if (entry.type === 'add') { outputLines.push(`+ ${entry.line}`); additions++; }
        else if (entry.type === 'remove') { outputLines.push(`- ${entry.line}`); deletions++; }
        else { outputLines.push(`  ${entry.line}`); }
        lastShown = i;
      }

      const summary = `📊 Summary: +${additions} line(s) added, -${deletions} line(s) removed`;
      return {
        content: `${summary}\n\n\`\`\`diff\n${outputLines.join('\n')}\n\`\`\``,
      };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
