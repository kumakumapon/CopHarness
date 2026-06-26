import { type SkillDefinition } from '../skill';
import { buildGithubHeaders } from '../utils/github';

/**
 * GitHub Search skill using the GitHub REST API.
 * GITHUB_TOKEN is optional but recommended to avoid rate limiting.
 */

interface GithubRepo {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  html_url: string;
  language: string | null;
}

interface GithubIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  user: { login: string } | null;
  created_at: string;
}

interface GithubSearchReposResponse {
  total_count: number;
  items: GithubRepo[];
}

interface GithubSearchIssuesResponse {
  total_count: number;
  items: GithubIssue[];
}

export const githubSearch: SkillDefinition = {
  name: 'githubSearch',
  description:
    'Searches GitHub for repositories or issues using the GitHub Search API. ' +
    'Set GITHUB_TOKEN for higher rate limits (optional).',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query (GitHub search syntax supported).',
      },
      type: {
        type: 'string',
        description: 'What to search: "repositories" or "issues". Defaults to "repositories".',
        enum: ['repositories', 'issues'],
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return (1–10). Defaults to 5.',
        minimum: 1,
        maximum: 10,
      },
    },
    required: ['query'],
  },
  category: 'external',
  riskLevel: 'low',
  handler: async (args) => {
    const query = String(args.query ?? '').trim();
    if (!query) return { content: 'Error: query is required', isError: true };
    const type = String(args.type ?? 'repositories');
    const maxResults = typeof args.maxResults === 'number'
      ? Math.min(10, Math.max(1, Math.floor(args.maxResults)))
      : 5;

    const endpoint = type === 'issues'
      ? `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=${maxResults}`
      : `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${maxResults}&sort=stars&order=desc`;

    try {
      const response = await fetch(endpoint, { headers: buildGithubHeaders() });
      if (!response.ok) {
        return { content: `Error: GitHub API returned ${response.status} ${response.statusText}`, isError: true };
      }

      if (type === 'issues') {
        const data = await response.json() as GithubSearchIssuesResponse;
        if (data.items.length === 0) return { content: 'No issues found.' };
        const lines = data.items.map(
          (i) => `#${i.number} [${i.state}] ${i.title}\n  URL: ${i.html_url}\n  By: ${i.user?.login ?? 'unknown'} on ${i.created_at.slice(0, 10)}`,
        );
        return { content: `Found ${data.total_count} issues (showing ${data.items.length}):\n\n${lines.join('\n\n')}` };
      } else {
        const data = await response.json() as GithubSearchReposResponse;
        if (data.items.length === 0) return { content: 'No repositories found.' };
        const lines = data.items.map(
          (r) => `⭐ ${r.stargazers_count} ${r.full_name} [${r.language ?? 'unknown'}]\n  ${r.description ?? '(no description)'}\n  ${r.html_url}`,
        );
        return { content: `Found ${data.total_count} repositories (showing ${data.items.length}):\n\n${lines.join('\n\n')}` };
      }
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
