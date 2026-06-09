/**
 * Shared preview redaction helpers for diagnostic logs, dashboard previews, and
 * future Tool Policy Engine dry-runs. The goal is to preserve enough shape for
 * debugging while ensuring common secret-bearing fields and inline credentials
 * are never written to local JSON logs or telemetry previews.
 */

const REDACTED = '[REDACTED]';
const MAX_REDACTION_DEPTH = 8;

const SENSITIVE_KEY_PATTERN = /(?:^|[_-])(api[_-]?key|auth(?:orization)?|bearer|cookie|credential|password|passphrase|private[_-]?key|refresh[_-]?token|secret|session|token)(?:$|[_-])/i;

const INLINE_SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{12,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{12,}\b/g,
  /\b(?:api[_-]?key|authorization|password|passphrase|private[_-]?key|refresh[_-]?token|secret|token)\s*[:=]\s*([^\s,;}{\]]+)/gi,
];

export function isSensitivePreviewKey(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  return SENSITIVE_KEY_PATTERN.test(normalized);
}

function redactString(value: string): string {
  return INLINE_SECRET_PATTERNS.reduce((text, pattern) => {
    if (pattern.source.includes('Bearer')) return text.replace(pattern, 'Bearer [REDACTED]');
    if (pattern.source.includes('api')) return text.replace(pattern, (match) => {
      const separator = match.includes('=') ? '=' : ':';
      const [prefix] = match.split(separator);
      return `${prefix}${separator}${REDACTED}`;
    });
    return text.replace(pattern, REDACTED);
  }, value);
}

function redactJsonLikeSecrets(text: string): string {
  return text
    .replace(/("(?:api[_-]?key|authorization|password|passphrase|private[_-]?key|refresh[_-]?token|secret|token)"\s*:\s*")([^"]+)(")/gi, `$1${REDACTED}$3`)
    .replace(/('(api[_-]?key|authorization|password|passphrase|private[_-]?key|refresh[_-]?token|secret|token)'\s*:\s*')([^']+)(')/gi, `$1${REDACTED}$4`);
}

export function redactPreviewValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactJsonLikeSecrets(redactString(value));
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_REDACTION_DEPTH) return '[MaxDepth]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactPreviewValue(item, depth + 1, seen));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = isSensitivePreviewKey(key) ? REDACTED : redactPreviewValue(nested, depth + 1, seen);
  }
  return redacted;
}

export function redactPreviewText(text: string): string {
  return redactJsonLikeSecrets(redactString(text));
}

export { REDACTED as REDACTED_PREVIEW_VALUE };
