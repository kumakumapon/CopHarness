import { type SkillDefinition } from '../skill';

/**
 * Markdown to HTML conversion skill (no external dependencies).
 * Converts a subset of Markdown syntax to HTML.
 */

/** Minimal Markdown → HTML converter (no external dependencies). */
function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const output: string[] = [];
  let inCodeBlock = false;
  let inList = false;
  let inOrderedList = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Fenced code blocks
    if (line.trim().startsWith('```')) {
      if (!inCodeBlock) {
        if (inList) { output.push('</ul>'); inList = false; }
        if (inOrderedList) { output.push('</ol>'); inOrderedList = false; }
        const lang = line.trim().slice(3).trim();
        output.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>`);
        inCodeBlock = true;
      } else {
        output.push('</code></pre>');
        inCodeBlock = false;
      }
      continue;
    }
    if (inCodeBlock) {
      output.push(escapeHtml(line));
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      if (inList) { output.push('</ul>'); inList = false; }
      if (inOrderedList) { output.push('</ol>'); inOrderedList = false; }
      const level = headingMatch[1].length;
      output.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      if (inList) { output.push('</ul>'); inList = false; }
      if (inOrderedList) { output.push('</ol>'); inOrderedList = false; }
      output.push('<hr>');
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^[-*+]\s+(.*)/);
    if (ulMatch) {
      if (inOrderedList) { output.push('</ol>'); inOrderedList = false; }
      if (!inList) { output.push('<ul>'); inList = true; }
      output.push(`  <li>${inlineMarkdown(ulMatch[1])}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      if (inList) { output.push('</ul>'); inList = false; }
      if (!inOrderedList) { output.push('<ol>'); inOrderedList = true; }
      output.push(`  <li>${inlineMarkdown(olMatch[1])}</li>`);
      continue;
    }

    // Close lists on empty or non-list lines
    if (inList) { output.push('</ul>'); inList = false; }
    if (inOrderedList) { output.push('</ol>'); inOrderedList = false; }

    // Blockquote
    const bqMatch = line.match(/^>\s?(.*)/);
    if (bqMatch) {
      output.push(`<blockquote>${inlineMarkdown(bqMatch[1])}</blockquote>`);
      continue;
    }

    // Empty line → paragraph separator
    if (line.trim() === '') {
      output.push('');
      continue;
    }

    // Regular paragraph line
    output.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  if (inList) output.push('</ul>');
  if (inOrderedList) output.push('</ol>');
  if (inCodeBlock) output.push('</code></pre>');

  // Wrap in basic HTML document
  const body = output.join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 800px; margin: 2rem auto; line-height: 1.6; color: #333; }
  pre { background: #f6f8fa; padding: 1rem; overflow-x: auto; border-radius: 4px; }
  code { font-family: monospace; background: #f6f8fa; padding: .1em .3em; border-radius: 3px; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #ccc; margin: 0; padding-left: 1rem; color: #666; }
  hr { border: none; border-top: 1px solid #eee; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function inlineMarkdown(text: string): string {
  // Inline code — escape content before wrapping to prevent XSS
  text = text.replace(/`([^`]+)`/g, (_, code: string) => `<code>${escapeHtml(code)}</code>`);
  // Bold + italic
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
  // Italic
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  text = text.replace(/_(.+?)_/g, '<em>$1</em>');
  // Strikethrough
  text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
  // Links — validate URL scheme and escape text/href
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText: string, href: string) => {
    const safeHref = /^https?:\/\//i.test(href.trim()) ? escapeHtml(href.trim()) : '#';
    return `<a href="${safeHref}">${escapeHtml(linkText)}</a>`;
  });
  // Images — escape alt and src, only allow http/https src
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt: string, src: string) => {
    const safeSrc = /^https?:\/\//i.test(src.trim()) ? escapeHtml(src.trim()) : '';
    return `<img alt="${escapeHtml(alt)}"${safeSrc ? ` src="${safeSrc}"` : ''}>`;
  });
  return text;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const markdownToHtmlSkill: SkillDefinition = {
  name: 'markdownToHtml',
  description:
    'Converts Markdown text to a full HTML document (no external dependencies). ' +
    'Supports headings, bold, italic, strikethrough, inline code, fenced code blocks, ' +
    'links, images, unordered/ordered lists, blockquotes, and horizontal rules.',
  parameters: {
    type: 'object',
    properties: {
      markdown: {
        type: 'string',
        description: 'The Markdown text to convert.',
      },
    },
    required: ['markdown'],
  },
  category: 'utility',
  riskLevel: 'low',
  handler: async (args) => {
    const md = String(args.markdown ?? '');
    if (!md.trim()) return { content: 'Error: markdown is required', isError: true };
    try {
      const html = markdownToHtml(md);
      return { content: html };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
