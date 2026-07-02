import { type SkillDefinition } from '../skill';
import { getExecutionBackend } from '../execution';

function makeUnifiedDiff(filePath: string, before: string, after: string): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const maxLines = 80;
  const lines = [`--- a/${filePath}`, `+++ b/${filePath}`];
  const count = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < count && lines.length < maxLines; i++) {
    const oldLine = beforeLines[i];
    const newLine = afterLines[i];
    if (oldLine === newLine) {
      lines.push(` ${oldLine ?? ''}`);
    } else {
      if (oldLine !== undefined) lines.push(`-${oldLine}`);
      if (newLine !== undefined) lines.push(`+${newLine}`);
    }
  }
  if (count + 2 > maxLines) lines.push('[diff truncated]');
  return lines.join('\n');
}

export const writeFile: SkillDefinition = {
  name: 'writeFile',
  description:
    'Writes text content to a file inside the sandbox directory (SKILL_FILE_SANDBOX_DIR, default: ./workspace). ' +
    'Creates the file and any missing parent directories. Use relative paths only.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file inside the sandbox, e.g. "output.txt" or "results/data.json".',
      },
      content: {
        type: 'string',
        description: 'Text content to write to the file.',
      },
      append: {
        type: 'boolean',
        description: 'If true, appends to an existing file instead of overwriting. Defaults to false.',
      },
    },
    required: ['path', 'content'],
  },
  category: 'file',
  riskLevel: 'medium',
  dryRun: async (args) => {
    const userPath = String(args.path ?? '').trim();
    const content = String(args.content ?? '');
    const append = args.append === true;
    if (!userPath) throw new Error('path is required');
    const backend = getExecutionBackend();
    let before = '';
    let existed = true;
    try {
      before = (await backend.readFile({ relativePath: userPath, maxBytes: 100_000 })).content;
    } catch {
      existed = false;
    }
    const after = append ? before + content : content;
    return {
      summary: `${append ? 'Append to' : existed ? 'Overwrite' : 'Create'} file ${userPath} (${content.length} characters).`,
      targets: [userPath],
      diff: makeUnifiedDiff(userPath, before, after),
      details: { path: userPath, append, existed, characters: content.length, backend: backend.kind },
      riskAttributes: ['file-write'],
    };
  },
  handler: async (args) => {
    const userPath = String(args.path ?? '').trim();
    const content = String(args.content ?? '');
    const append = args.append === true;
    if (!userPath) return { content: 'Error: path is required', isError: true };
    try {
      const backend = getExecutionBackend();
      await backend.writeFile({ relativePath: userPath, content, append });
      return { content: `Successfully ${append ? 'appended to' : 'wrote'} "${userPath}" (${content.length} characters).` };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
