/**
 * ExecutionBackend factory and singleton cache.
 *
 * Shared env vars:
 *   EXECUTION_BACKEND         — "local" | "docker" | "ssh" (default: "local")
 *   EXECUTION_ENV_ALLOWLIST   — comma-separated env var names forwarded to docker/ssh (default: "")
 *   EXECUTION_TIMEOUT_MS      — default command timeout in ms (default: 10000)
 */

import { LocalBackend } from './localBackend';
import { createDockerBackend } from './dockerBackend';
import { createSshBackend } from './sshBackend';
import { type ExecutionBackend } from './types';

export * from './types';
export * from './policy';
export { LocalBackend } from './localBackend';
export { DockerBackend, createDockerBackend } from './dockerBackend';
export { SshBackend, createSshBackend, shellQuote } from './sshBackend';

let _cachedBackend: ExecutionBackend | null = null;

/**
 * Return the singleton ExecutionBackend instance.
 * The backend is selected based on the EXECUTION_BACKEND environment variable.
 * An unknown value causes a warning and falls back to local.
 */
export function getExecutionBackend(): ExecutionBackend {
  if (_cachedBackend !== null) return _cachedBackend;

  const kind = (process.env.EXECUTION_BACKEND ?? 'local').toLowerCase();

  switch (kind) {
    case 'local':
      _cachedBackend = new LocalBackend();
      break;
    case 'docker':
      _cachedBackend = createDockerBackend();
      break;
    case 'ssh':
      _cachedBackend = createSshBackend();
      break;
    default:
      console.warn(
        `[ExecutionBackend] Unknown EXECUTION_BACKEND value "${kind}". Falling back to "local".`,
      );
      _cachedBackend = new LocalBackend();
      break;
  }

  return _cachedBackend;
}

/** Reset the cached backend instance (for use in tests). */
export function _resetExecutionBackendForTests(): void {
  _cachedBackend = null;
}
