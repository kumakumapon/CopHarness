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
}

export interface ExecutionBackend {
  kind: ExecutionBackendKind;
  runCommand(req: CommandRequest): Promise<CommandResult>;
  writeFile(req: WriteFileRequest): Promise<WriteFileResult>;
  describe(): ExecutionBackendDescription;
}
