import { searchInFiles } from '../../lib/skills/searchInFiles';
import { getExecutionBackend } from '../../lib/execution';
import { type ExecutionBackend, type ListDirResult, type ReadFileResult } from '../../lib/execution/types';

jest.mock('../../lib/execution', () => ({
  getExecutionBackend: jest.fn(),
}));

const mockGetExecutionBackend = getExecutionBackend as jest.MockedFunction<typeof getExecutionBackend>;

type TreeNode = string | { [name: string]: TreeNode };

function makeBackend(tree: { [name: string]: TreeNode }): jest.Mocked<ExecutionBackend> {
  const getNode = (relativePath = '.'): TreeNode => {
    if (relativePath === '.' || relativePath === '') return tree;
    const parts = relativePath.split('/').filter(Boolean);
    let current: TreeNode = tree;
    for (const part of parts) {
      if (typeof current === 'string' || !(part in current)) {
        throw new Error(`path "${relativePath}" does not exist`);
      }
      current = current[part];
    }
    return current;
  };

  return {
    kind: 'local',
    runCommand: jest.fn(),
    writeFile: jest.fn(),
    describe: jest.fn(),
    listDir: jest.fn(async ({ relativePath = '.' }) => {
      const node = getNode(relativePath);
      if (typeof node === 'string') throw new Error(`"${relativePath}" is not a directory`);
      const result: ListDirResult = {
        backend: 'local',
        entries: Object.entries(node).map(([name, child]) => ({
          name,
          type: typeof child === 'string' ? 'file' as const : 'directory' as const,
          ...(typeof child === 'string' ? { size: Buffer.byteLength(child, 'utf8') } : {}),
        })),
      };
      return result;
    }),
    readFile: jest.fn(async ({ relativePath, maxBytes }) => {
      const node = getNode(relativePath);
      if (typeof node !== 'string') throw new Error(`"${relativePath}" is not a file`);
      if (maxBytes !== undefined && node.length > maxBytes) {
        const result: ReadFileResult = { backend: 'local', content: node.slice(0, maxBytes), truncated: true };
        return result;
      }
      const result: ReadFileResult = { backend: 'local', content: node, truncated: false };
      return result;
    }),
  };
}

describe('searchInFiles ExecutionBackend integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses listDir and readFile on the configured backend', async () => {
    const backend = makeBackend({ 'data.txt': 'hello world\nbye\n' });
    mockGetExecutionBackend.mockReturnValue(backend);

    const result = await searchInFiles.handler({ pattern: 'hello' });

    expect(result.content).toBe('data.txt:1: hello world');
    expect(mockGetExecutionBackend).toHaveBeenCalledTimes(1);
    expect(backend.listDir).toHaveBeenCalledWith({ relativePath: '.' });
    expect(backend.readFile).toHaveBeenCalledWith({ relativePath: 'data.txt', maxBytes: 1_000_001 });
  });

  it('recursively searches backend directories and preserves relative path line output', async () => {
    const backend = makeBackend({
      src: {
        'a.txt': 'HELLO root\nnope',
        nested: {
          'b.txt': 'first\nhello nested',
        },
      },
    });
    mockGetExecutionBackend.mockReturnValue(backend);

    const result = await searchInFiles.handler({ pattern: 'hello', path: 'src' });

    expect(result.content).toContain('src/a.txt:1: HELLO root');
    expect(result.content).toContain('src/nested/b.txt:2: hello nested');
    expect(backend.listDir).toHaveBeenCalledWith({ relativePath: 'src' });
    expect(backend.listDir).toHaveBeenCalledWith({ relativePath: 'src/nested' });
  });

  it('returns an invalid regex error before calling the backend', async () => {
    const backend = makeBackend({ 'data.txt': 'hello' });
    mockGetExecutionBackend.mockReturnValue(backend);

    const result = await searchInFiles.handler({ pattern: '[' });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/^Error: invalid regex/);
    expect(mockGetExecutionBackend).not.toHaveBeenCalled();
  });

  it('surfaces backend errors such as allowed path violations', async () => {
    const backend = makeBackend({});
    backend.listDir.mockRejectedValue(new Error('Path "secret" is outside the allowed sandbox directory.'));
    backend.readFile.mockRejectedValue(new Error('Path "secret" is outside the allowed sandbox directory.'));
    mockGetExecutionBackend.mockReturnValue(backend);

    const result = await searchInFiles.handler({ pattern: 'token', path: 'secret' });

    expect(result).toEqual({
      content: 'Error: Path "secret" is outside the allowed sandbox directory.',
      isError: true,
    });
    expect(backend.listDir).toHaveBeenCalledWith({ relativePath: 'secret' });
    expect(backend.readFile).toHaveBeenCalledWith({ relativePath: 'secret', maxBytes: 1_000_001 });
  });

  it('skips files larger than the configured per-file byte limit', async () => {
    const backend = makeBackend({
      'large.txt': 'hello but metadata says it is too large',
      'small.txt': 'hello small',
    });
    backend.listDir.mockResolvedValueOnce({
      backend: 'local',
      entries: [
        { name: 'large.txt', type: 'file', size: 1_000_001 },
        { name: 'small.txt', type: 'file', size: 11 },
      ],
    });
    mockGetExecutionBackend.mockReturnValue(backend);

    const result = await searchInFiles.handler({ pattern: 'hello' });

    expect(result.content).toBe('small.txt:1: hello small');
    expect(backend.readFile).not.toHaveBeenCalledWith({ relativePath: 'large.txt', maxBytes: 1_000_001 });
  });

  it('returns a timeout error when the search deadline is exhausted', async () => {
    const originalTimeout = process.env.SEARCH_IN_FILES_TIMEOUT_MS;
    process.env.SEARCH_IN_FILES_TIMEOUT_MS = '0';
    const backend = makeBackend({ 'data.txt': 'hello' });
    mockGetExecutionBackend.mockReturnValue(backend);

    const result = await searchInFiles.handler({ pattern: 'hello' });

    expect(result).toEqual({ content: 'Error: searchInFiles timed out.', isError: true });
    expect(backend.listDir).not.toHaveBeenCalled();

    if (originalTimeout === undefined) {
      delete process.env.SEARCH_IN_FILES_TIMEOUT_MS;
    } else {
      process.env.SEARCH_IN_FILES_TIMEOUT_MS = originalTimeout;
    }
  });
});
