import { type SkillDefinition } from '../skill';

/**
 * YouTube video info skill using the oEmbed API (no API key required).
 * Returns title, author, thumbnail, and basic video metadata.
 * Inspired by the youtube-notes skill in karaage0703/ai-assistant-workspace.
 */

interface OEmbedResponse {
  title: string;
  author_name: string;
  author_url: string;
  thumbnail_url: string;
  thumbnail_width: number;
  thumbnail_height: number;
  provider_name: string;
  type: string;
  width: number;
  height: number;
}

/** Extract a YouTube video ID from a URL or bare ID. */
function extractVideoId(input: string): string | null {
  // Already a bare ID (11 chars, alphanumeric + - + _)
  if (/^[\w-]{11}$/.test(input)) return input;
  // youtu.be short URL
  const short = input.match(/youtu\.be\/([\w-]{11})/);
  if (short) return short[1];
  // youtube.com/watch?v= URL
  const watch = input.match(/[?&]v=([\w-]{11})/);
  if (watch) return watch[1];
  // youtube.com/embed/ or youtube.com/shorts/
  const embed = input.match(/(?:embed|shorts)\/([\w-]{11})/);
  if (embed) return embed[1];
  return null;
}

export const youtubeInfo: SkillDefinition = {
  name: 'youtubeInfo',
  description:
    'Fetches basic information about a YouTube video using the oEmbed API (no API key required). ' +
    'Returns the video title, channel name, thumbnail URL, and a link to the video. ' +
    'Accepts a YouTube URL or a video ID.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'YouTube video URL (e.g., "https://www.youtube.com/watch?v=dQw4w9WgXcQ") or video ID (e.g., "dQw4w9WgXcQ").',
      },
    },
    required: ['url'],
  },
  category: 'web',
  riskLevel: 'low',
  handler: async (args) => {
    const input = String(args.url ?? '').trim();
    if (!input) return { content: 'Error: url is required', isError: true };

    const videoId = extractVideoId(input);
    if (!videoId) {
      return { content: 'Error: could not extract a YouTube video ID from the provided input.', isError: true };
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      let response: Response;
      try {
        response = await fetch(oembedUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return { content: 'Error: this video is private or age-restricted and cannot be accessed.', isError: true };
        }
        if (response.status === 404) {
          return { content: `Error: video not found (ID: ${videoId}).`, isError: true };
        }
        return { content: `Error: YouTube oEmbed API returned ${response.status} ${response.statusText}`, isError: true };
      }

      const data = await response.json() as OEmbedResponse;
      const lines = [
        `🎬 **${data.title}**`,
        `📺 Channel: ${data.author_name}  (${data.author_url})`,
        `🔗 URL: ${videoUrl}`,
        `🖼️ Thumbnail: ${data.thumbnail_url}`,
        `📐 Embed size: ${data.width ?? '?'} × ${data.height ?? '?'}`,
      ];
      return { content: lines.join('\n') };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
