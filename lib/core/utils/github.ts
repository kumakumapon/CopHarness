/**
 * Shared GitHub API utilities.
 */

/**
 * Build the HTTP headers for GitHub REST API requests.
 * Uses GITHUB_TOKEN or GITHUB_COPILOT_API_KEY when available
 * to raise the rate limit above the unauthenticated 60 req/hr cap.
 */
export function buildGithubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GITHUB_COPILOT_API_KEY;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
