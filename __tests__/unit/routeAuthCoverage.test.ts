/**
 * Regression guard: every app/api/.../route.ts handler must call
 * `requireApiKey`, unless it has an explicit, justified allowlist entry
 * below. This prevents a newly added route from silently shipping
 * unauthenticated.
 */
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const API_DIR = path.join(REPO_ROOT, 'app', 'api');

/**
 * Routes that are intentionally exempt from `requireApiKey`, each with a
 * reason. If an allowlisted file no longer exists on disk, the allowlist has
 * rotted and the test fails so it gets cleaned up.
 */
const ALLOWLIST: Record<string, string> = {
  // Public liveness probe, returns no sensitive data.
  'app/api/health/route.ts': "public liveness probe, returns no sensitive data",
  // Authenticated by LINE's `validateSignature` request signature.
  'app/api/line/route.ts': "authenticated by LINE's validateSignature request signature",
  // Authenticated by GitHub webhook HMAC verification.
  'app/api/watchers/github/route.ts': 'authenticated by GitHub webhook HMAC verification',
};

function findRouteFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findRouteFiles(fullPath));
    } else if (entry.isFile() && entry.name === 'route.ts') {
      results.push(fullPath);
    }
  }
  return results;
}

describe('every API route requires an API key (or is explicitly allowlisted)', () => {
  it('has no unauthenticated route.ts files outside the allowlist', () => {
    const routeFiles = findRouteFiles(API_DIR);
    const missingAuth: string[] = [];

    for (const absPath of routeFiles) {
      const relPath = path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
      if (relPath in ALLOWLIST) continue;

      const source = fs.readFileSync(absPath, 'utf8');
      if (!source.includes('requireApiKey')) {
        missingAuth.push(relPath);
      }
    }

    if (missingAuth.length > 0) {
      throw new Error(
        `The following route(s) do not call requireApiKey: ${missingAuth.join(', ')}. ` +
          'Add `requireApiKey` to the route, or add a justified entry to the ' +
          'ALLOWLIST in __tests__/unit/routeAuthCoverage.test.ts.',
      );
    }
  });

  it('has no stale allowlist entries pointing at files that no longer exist', () => {
    const missingFiles = Object.keys(ALLOWLIST).filter(
      (relPath) => !fs.existsSync(path.join(REPO_ROOT, relPath)),
    );

    if (missingFiles.length > 0) {
      throw new Error(
        `The following allowlisted route(s) no longer exist on disk: ${missingFiles.join(
          ', ',
        )}. Remove the stale entry from ALLOWLIST in __tests__/unit/routeAuthCoverage.test.ts.`,
      );
    }
  });
});
