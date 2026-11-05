import { bashTool } from './bash';
import { editFileTool, grepTool, listFilesTool, readFileTool, writeFileTool } from './files';
import { memoryTool } from './memory';
import { taskTool, todoTool } from './agentTools';
import { webFetchTool } from './web';
import type { Tool } from './types';

export * from './types';

/** The built-in toolset: a few general tools rather than many narrow ones. */
export function builtinTools(): Tool[] {
  return [readFileTool, writeFileTool, editFileTool, listFilesTool, grepTool, bashTool, webFetchTool, todoTool, taskTool, memoryTool];
}

function matches(pattern: string, name: string): boolean {
  const re = pattern.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${re}$`).test(name);
}

/** Remove tools disabled in config (`tools.disabled`, globs allowed); first definition of a name wins. */
export function filterTools(tools: Tool[], disabled: string[]): Tool[] {
  const seen = new Set<string>();
  return tools.filter(t => {
    if (seen.has(t.name) || disabled.some(p => matches(p, t.name))) return false;
    seen.add(t.name);
    return true;
  });
}
