/**
 * Execution policy enforcement for the ExecutionBackend abstraction.
 *
 * This module reads EXECUTION_ALLOWED_PATHS and EXECUTION_NETWORK_POLICY
 * environment variables and exposes helpers that backend implementations
 * call before performing I/O.
 *
 * NOTE: The network-command denylist implemented here is a heuristic
 * best-effort guard. It prevents accidental use of common network tools
 * but does NOT provide complete network isolation. For true network
 * restriction, configure the underlying infrastructure (e.g., Docker
 * `--network none`, OS-level firewall rules, or cgroups net_cls).
 */

// ---------------------------------------------------------------------------
// Relative path enforcement
// ---------------------------------------------------------------------------

/**
 * Enforce that a path is relative: no leading '/', no '..' segments.
 * Throws a descriptive error when the constraint is violated.
 */
export function enforceRelativePath(relativePath: string): void {
  if (relativePath.startsWith('/')) {
    throw new Error(`Path "${relativePath}" must be relative (no leading slash).`);
  }
  const segments = relativePath.split(/[\\/]/);
  if (segments.some((s) => s === '..')) {
    throw new Error(`Path "${relativePath}" must not contain '..' segments.`);
  }
}

// ---------------------------------------------------------------------------
// Path allowlist
// ---------------------------------------------------------------------------

/**
 * Return the list of allowed path prefixes parsed from EXECUTION_ALLOWED_PATHS,
 * or null when the variable is unset / empty (i.e., no restriction).
 *
 * The env var is a comma-separated list of relative path prefixes, e.g.
 *   EXECUTION_ALLOWED_PATHS=outputs,reports/daily
 *
 * Each entry is trimmed, stripped of a leading "./" and a trailing "/".
 * Empty entries after normalisation are discarded.
 * When no valid entries remain, null is returned (unrestricted — backwards-compatible).
 */
export function getAllowedPathPrefixes(): string[] | null {
  const raw = process.env.EXECUTION_ALLOWED_PATHS;
  if (!raw) return null;

  const prefixes = raw
    .split(',')
    .map((s) => {
      let p = s.trim();
      // Remove leading "./"
      if (p.startsWith('./')) p = p.slice(2);
      // Remove trailing "/"
      while (p.endsWith('/')) p = p.slice(0, -1);
      return p;
    })
    .filter((p) => p.length > 0);

  return prefixes.length > 0 ? prefixes : null;
}

/**
 * Throw when relativePath is outside the configured allowed prefixes.
 * Does nothing when no allowlist is configured (null).
 *
 * A prefix of "." acts as a wildcard that permits all paths.
 */
export function enforceAllowedPath(relativePath: string): void {
  const prefixes = getAllowedPathPrefixes();
  if (prefixes === null) return; // unrestricted

  // Normalise the candidate path
  let p = relativePath.replace(/\\/g, '/');
  if (p.startsWith('./')) p = p.slice(2);
  // Remove trailing slashes (keep bare "." unchanged)
  if (p !== '.') {
    while (p.endsWith('/')) p = p.slice(0, -1);
  }

  // Check against each allowed prefix
  for (const prefix of prefixes) {
    // "." prefix means allow everything
    if (prefix === '.') return;

    if (p === '.') {
      // Root is allowed only when "." is in the list (handled above) — denied otherwise
      continue;
    }

    if (p === prefix || p.startsWith(prefix + '/')) {
      return; // allowed
    }
  }

  throw new Error(
    `Path "${relativePath}" is outside EXECUTION_ALLOWED_PATHS (allowed: ${prefixes.join(', ')})`,
  );
}

// ---------------------------------------------------------------------------
// Network policy
// ---------------------------------------------------------------------------

/**
 * Network commands subject to denial when EXECUTION_NETWORK_POLICY=deny.
 * Comparison is done on the basename of the command, lowercased.
 */
const NETWORK_COMMAND_DENYLIST = new Set([
  'curl',
  'wget',
  'nc',
  'ncat',
  'netcat',
  'ssh',
  'scp',
  'sftp',
  'ftp',
  'telnet',
  'ping',
  'ping6',
  'nslookup',
  'dig',
  'host',
  'rsync',
  'traceroute',
]);

/** Return the effective network policy: 'allow' or 'deny'. */
export function getNetworkPolicy(): 'allow' | 'deny' {
  const raw = (process.env.EXECUTION_NETWORK_POLICY ?? 'allow').trim().toLowerCase();
  if (raw === 'deny') return 'deny';
  if (raw !== 'allow') {
    console.warn(
      `[ExecutionPolicy] Unknown EXECUTION_NETWORK_POLICY value "${process.env.EXECUTION_NETWORK_POLICY}". Treating as "allow".`,
    );
  }
  return 'allow';
}

/**
 * Throw when EXECUTION_NETWORK_POLICY=deny and command is a known network tool.
 * The command may be a bare name ("curl") or a full path ("/usr/bin/curl");
 * only the basename is checked, case-insensitively.
 */
export function enforceNetworkPolicy(command: string): void {
  if (getNetworkPolicy() !== 'deny') return;

  // Extract basename (works for both / and \ separators)
  const base = command.replace(/\\/g, '/').split('/').pop() ?? command;
  if (NETWORK_COMMAND_DENYLIST.has(base.toLowerCase())) {
    throw new Error(
      `Command "${command}" is blocked by EXECUTION_NETWORK_POLICY=deny`,
    );
  }
}
