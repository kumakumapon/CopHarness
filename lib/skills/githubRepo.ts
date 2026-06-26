import { type SkillDefinition } from '../skill';
import { buildGithubHeaders } from '../utils/github';

/**
 * GitHub repository analysis skill.
 * Returns detailed repo metadata, top contributors, recent commits, and open issues.
 * GITHUB_TOKEN is optional but recommended to avoid rate limiting.
 * Inspired by the github-repo-analyzer skill in karaage0703/ai-assistant-workspace.
 */

interface GithubRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  topics: string[];
  license: { name: string } | null;
  created_at: string;
  updated_at: string;
  default_branch: string;
  size: number;
  watchers_count: number;
  subscribers_count: number;
  homepage: string | null;
}

interface GithubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
}

interface GithubContributor {
  login: string;
  contributions: number;
  html_url: string;
}

interface GithubIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
}

async function ghFetch<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { headers: buildGithubHeaders(), signal: controller.signal });
    if (!res.ok) return null;
    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Parse "owner/repo" or a full GitHub URL into { owner, repo }. */
function parseRepo(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim().replace(/\/$/, '');
  // Full URL: https://github.com/owner/repo
  const urlMatch = trimmed.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };
  // Short form: owner/repo
  const shortMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2] };
  return null;
}

export const githubRepo: SkillDefinition = {
  name: 'githubRepo',
  description:
    'Analyzes a GitHub repository in detail: metadata (stars, forks, topics, license), ' +
    'recent commits, top contributors, and open issues. ' +
    'Accepts "owner/repo" or a full GitHub URL. ' +
    'Set GITHUB_TOKEN for higher rate limits (optional).',
  parameters: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        description: 'Repository in "owner/repo" format or a full GitHub URL (e.g., "microsoft/vscode" or "https://github.com/microsoft/vscode").',
      },
    },
    required: ['repo'],
  },
  category: 'external',
  riskLevel: 'low',
  handler: async (args) => {
    const repoInput = String(args.repo ?? '').trim();
    if (!repoInput) return { content: 'Error: repo is required', isError: true };

    const parsed = parseRepo(repoInput);
    if (!parsed) {
      return { content: 'Error: could not parse repository. Use "owner/repo" format or a GitHub URL.', isError: true };
    }
    const { owner, repo } = parsed;
    const base = `https://api.github.com/repos/${owner}/${repo}`;

    try {
      // Fetch all data in parallel
      const [repoData, commits, contributors, issues] = await Promise.all([
        ghFetch<GithubRepo>(base),
        ghFetch<GithubCommit[]>(`${base}/commits?per_page=5`),
        ghFetch<GithubContributor[]>(`${base}/contributors?per_page=5&anon=false`),
        ghFetch<GithubIssue[]>(`${base}/issues?state=open&per_page=5`),
      ]);

      if (!repoData) {
        return { content: `Error: repository "${owner}/${repo}" not found or not accessible.`, isError: true };
      }

      const lines: string[] = [
        `## ${repoData.full_name}`,
        repoData.description ? `**${repoData.description}**` : '',
        '',
        `🔗 ${repoData.html_url}`,
        repoData.homepage ? `🌐 Homepage: ${repoData.homepage}` : '',
        '',
        `⭐ Stars: ${repoData.stargazers_count.toLocaleString()}  |  🍴 Forks: ${repoData.forks_count.toLocaleString()}  |  👁 Watchers: ${repoData.watchers_count.toLocaleString()}`,
        `🐛 Open Issues: ${repoData.open_issues_count.toLocaleString()}  |  📦 Size: ${(repoData.size / 1024).toFixed(1)} MB`,
        `💻 Primary Language: ${repoData.language ?? 'N/A'}`,
        repoData.license ? `📄 License: ${repoData.license.name}` : '',
        repoData.topics.length > 0 ? `🏷️ Topics: ${repoData.topics.join(', ')}` : '',
        `📅 Created: ${repoData.created_at.slice(0, 10)}  |  Last updated: ${repoData.updated_at.slice(0, 10)}`,
        `🌿 Default branch: ${repoData.default_branch}`,
      ].filter(Boolean);

      if (commits && commits.length > 0) {
        lines.push('', '### Recent Commits');
        for (const c of commits) {
          const msg = c.commit.message.split('\n')[0].slice(0, 80);
          lines.push(`- \`${c.sha.slice(0, 7)}\` ${msg}  (${c.commit.author.name}, ${c.commit.author.date.slice(0, 10)})`);
        }
      }

      if (contributors && contributors.length > 0) {
        lines.push('', '### Top Contributors');
        for (const c of contributors) {
          lines.push(`- ${c.login}: ${c.contributions} commits  (${c.html_url})`);
        }
      }

      if (issues && issues.length > 0) {
        lines.push('', '### Recent Open Issues');
        for (const issue of issues) {
          lines.push(`- #${issue.number}: ${issue.title}  (${issue.html_url})`);
        }
      } else if (issues !== null) {
        lines.push('', '### Open Issues', '(No open issues)');
      }

      return { content: lines.join('\n') };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
