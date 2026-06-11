/**
 * Core types for the ExecutionBackend abstraction.
 * Supports local, docker, and ssh execution environments.
 */

export type ExecutionBackendKind = 'local' | 'docker' | 'ssh';

export interface CommandRequest {
  command: string;
  args: string[];
  timeoutMs?: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  backend: ExecutionBackendKind;
}

export interface WriteFileRequest {
  relativePath: string;
  content: string;
  append?: boolean;
}

export interface WriteFileResult {
  path: string;
  bytesWritten: number;
  backend: ExecutionBackendKind;
}

export interface ExecutionBackendDescription {
  kind: ExecutionBackendKind;
  workingDir: string;
  envAllowlist: string[];
  timeoutMs: number;
  detail?: string;
  allowedPaths?: string[];
  networkPolicy?: 'allow' | 'deny';
}

export interface ReadFileRequest {
  relativePath: string;
  /** Maximum characters to return. Content longer than this is truncated. */
  maxBytes?: number;
}

export interface ReadFileResult {
  content: string;
  truncated: boolean;
  backend: ExecutionBackendKind;
}

export interface ListDirEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface ListDirRequest {
  /** Relative path inside the workdir/sandbox. Defaults to '.'. */
  relativePath?: string;
}

export interface ListDirResult {
  entries: ListDirEntry[];
  backend: ExecutionBackendKind;
}

export interface ExecutionBackend {
  kind: ExecutionBackendKind;
  runCommand(req: CommandRequest): Promise<CommandResult>;
  writeFile(req: WriteFileRequest): Promise<WriteFileResult>;
  readFile(req: ReadFileRequest): Promise<ReadFileResult>;
  listDir(req: ListDirRequest): Promise<ListDirResult>;
  describe(): ExecutionBackendDescription;
}
