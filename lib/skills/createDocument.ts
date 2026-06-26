import fs from 'node:fs/promises';
import path from 'node:path';
import { type SkillDefinition } from '../skill';
import { resolveSafe } from './fileSandbox';
import { escapeHtml } from '../utils/html';

interface DocumentSection {
  heading: string;
  content: string;
}

function buildMarkdownDoc(title: string, sections: DocumentSection[]): string {
  const lines: string[] = [`# ${title}`, ''];
  for (const section of sections) {
    lines.push(`## ${section.heading}`, '');
    lines.push(section.content, '');
  }
  return lines.join('\n');
}

function buildHtmlDoc(title: string, sections: DocumentSection[]): string {
  const tocItems = sections
    .map((s, i) => `    <li><a href="#section-${i}">${escapeHtml(s.heading)}</a></li>`)
    .join('\n');

  const sectionHtml = sections
    .map((s, i) => {
      const paragraphs = s.content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `    <p>${escapeHtml(line)}</p>`)
        .join('\n');
      return [
        `  <section id="section-${i}">`,
        `    <h2>${escapeHtml(s.heading)}</h2>`,
        paragraphs,
        `  </section>`,
      ].join('\n');
    })
    .join('\n\n');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.7; color: #333; }
  h1 { font-size: 2rem; border-bottom: 2px solid #333; padding-bottom: 0.4em; margin-bottom: 1.5rem; }
  h2 { font-size: 1.4rem; border-bottom: 1px solid #eee; color: #444; margin-top: 2.5rem; margin-bottom: 0.8rem; padding-bottom: 0.3em; }
  p { margin-bottom: 1em; }
  nav { background: #f8f9fa; border: 1px solid #eee; border-radius: 6px; padding: 1rem 1.5rem; margin-bottom: 2rem; }
  nav h2 { font-size: 1rem; margin-top: 0; border: none; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
  nav ol { margin: 0.5rem 0 0; padding-left: 1.5rem; }
  nav li { margin: 0.25rem 0; }
  nav a { color: #0066cc; text-decoration: none; }
  nav a:hover { text-decoration: underline; }
  section { margin-bottom: 2.5rem; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<nav>
  <h2>目次 / Table of Contents</h2>
  <ol>
${tocItems}
  </ol>
</nav>

${sectionHtml}
</body>
</html>`;
}

function parseSections(raw: unknown): DocumentSection[] | null {
  const str = String(raw ?? '').trim();
  if (!str) return null;
  try {
    const parsed: unknown = JSON.parse(str);
    if (!Array.isArray(parsed)) return null;
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) return null;
      if (typeof (item as Record<string, unknown>).heading !== 'string') return null;
      if (typeof (item as Record<string, unknown>).content !== 'string') return null;
    }
    return parsed as DocumentSection[];
  } catch {
    return null;
  }
}

export const createDocument: SkillDefinition = {
  name: 'createDocument',
  description:
    'Creates a structured document from a title and sections, and saves it to the sandbox directory. ' +
    'Accepts a JSON array of sections (each with "heading" and "content" fields). ' +
    'Output format is either "markdown" (default, saves as .md) or "html" (saves as .html with TOC and styled layout). ' +
    'Inspired by OpenClaw\'s SKILL.md document pattern and Hermes Agent\'s document creation capabilities. ' +
    'Use for reports, meeting notes, research summaries, manuals, and any long-form documents.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Document title.',
      },
      sections: {
        type: 'string',
        description:
          'JSON array of sections: [{"heading":"Introduction","content":"Full text here."},...]',
      },
      format: {
        type: 'string',
        description: 'Output format: "markdown" (default) or "html".',
        enum: ['markdown', 'html'],
      },
      filename: {
        type: 'string',
        description:
          'Output filename relative to the sandbox (e.g. "report.md"). ' +
          'Auto-generated as "document-<timestamp>.md|html" if omitted.',
      },
    },
    required: ['title', 'sections'],
  },
  category: 'file',
  riskLevel: 'medium',
  handler: async (args) => {
    const title = String(args.title ?? '').trim();
    if (!title) return { content: 'Error: title is required', isError: true };

    const sections = parseSections(args.sections);
    if (sections === null) {
      return {
        content:
          'Error: invalid sections JSON — expected an array like ' +
          '[{"heading":"...","content":"..."}]',
        isError: true,
      };
    }
    if (sections.length === 0) {
      return { content: 'Error: sections array must not be empty', isError: true };
    }

    const format = String(args.format ?? 'markdown').trim();
    const ext = format === 'html' ? '.html' : '.md';
    const filename = String(args.filename ?? '').trim() || `document-${Date.now()}${ext}`;

    try {
      const docContent = format === 'html'
        ? buildHtmlDoc(title, sections)
        : buildMarkdownDoc(title, sections);

      const resolved = await resolveSafe(filename);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, docContent, 'utf8');

      const preview = docContent.slice(0, 400) + (docContent.length > 400 ? '\n...' : '');
      return {
        content: [
          `Document created: "${filename}"`,
          `Format: ${format}`,
          `Sections: ${sections.length}`,
          `Size: ${docContent.length} characters`,
          '',
          'Preview:',
          preview,
        ].join('\n'),
      };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
