import fs from 'node:fs/promises';
import path from 'node:path';
import { type SkillDefinition } from '../skill';
import { resolveSafe } from './fileSandbox';
import { parseSlides, type SlideItem as PptxSlide } from '../utils/slides';

interface ThemeConfig {
  background: { color: string };
  titleColor: string;
  bodyColor: string;
}

/** Minimal interface for the pptxgenjs slide object (methods we actually call). */
interface PptxGenSlide {
  background: { color: string };
  addText(text: string | object[], options: object): void;
}

/** Minimal interface for the pptxgenjs presentation object (methods we actually call). */
interface PptxGenPresentation {
  layout: string;
  addSlide(): PptxGenSlide;
  write(opts: { outputType: string }): Promise<Buffer>;
}

const THEMES: Record<string, ThemeConfig> = {
  default: { background: { color: 'FFFFFF' }, titleColor: '003366', bodyColor: '333333' },
  dark:    { background: { color: '1E1E2E' }, titleColor: 'CBA6F7', bodyColor: 'CDD6F4' },
  minimal: { background: { color: 'FAFAFA' }, titleColor: '111111', bodyColor: '555555' },
};

/**
 * Dynamically load pptxgenjs at runtime so the skill works even when the
 * package is not installed (returns null in that case).
 */
async function loadPptxGen(): Promise<(new () => PptxGenPresentation) | null> {
  try {
    const mod = require('pptxgenjs') as { default?: unknown; [key: string]: unknown };
    const ctor = mod.default ?? mod;
    if (typeof ctor === 'function') {
      return ctor as unknown as new () => PptxGenPresentation;
    }
    return null;
  } catch {
    return null;
  }
}

export const createPresentation: SkillDefinition = {
  name: 'createPresentation',
  description:
    'Creates a native PowerPoint (.pptx) presentation and saves it to the sandbox directory. ' +
    'Uses the pptxgenjs library (must be installed: npm install pptxgenjs). ' +
    'Accepts a JSON array of slides with title and bullet points. ' +
    'Supports three themes: "default" (white/navy), "dark" (dark purple), "minimal" (light grey). ' +
    'The output is editable in Microsoft PowerPoint, LibreOffice Impress, and Google Slides. ' +
    'Inspired by Hermes Agent\'s pptxgenjs-based presentation generation skill. ' +
    'If pptxgenjs is not installed, returns an installation hint.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Presentation title (shown on the opening title slide).',
      },
      slides: {
        type: 'string',
        description:
          'JSON array of slide objects: ' +
          '[{"title":"Slide Title","bullets":["Point 1","Point 2"],"layout":"bullets"},...] ' +
          'layout is optional: "title" (title only), "bullets" (default), "blank".',
      },
      theme: {
        type: 'string',
        description: 'Visual theme: "default" (white), "dark" (dark purple), "minimal" (light grey).',
        enum: ['default', 'dark', 'minimal'],
      },
      filename: {
        type: 'string',
        description:
          'Output filename relative to the sandbox (must end in .pptx). ' +
          'Auto-generated as "presentation-<timestamp>.pptx" if omitted.',
      },
    },
    required: ['title', 'slides'],
  },
  category: 'file',
  riskLevel: 'medium',
  handler: async (args) => {
    const presTitle = String(args.title ?? '').trim();
    if (!presTitle) return { content: 'Error: title is required', isError: true };

    const slideItems = parseSlides(args.slides);
    if (slideItems === null) {
      return {
        content:
          'Error: invalid slides JSON — expected an array like ' +
          '[{"title":"...","bullets":["..."],"layout":"bullets"}]',
        isError: true,
      };
    }
    if (slideItems.length === 0) {
      return { content: 'Error: slides array must not be empty', isError: true };
    }

    const PptxGen = await loadPptxGen();
    if (!PptxGen) {
      return {
        content: [
          'Error: pptxgenjs is not installed.',
          'Install it with: npm install pptxgenjs',
          'Then restart the server.',
          '',
          'Alternatively, use createSlideshow to generate a dependency-free HTML5 presentation.',
        ].join('\n'),
        isError: true,
      };
    }

    const rawTheme = String(args.theme ?? 'default').trim().toLowerCase();
    const themeConfig = THEMES[rawTheme] ?? THEMES.default;
    const filename = String(args.filename ?? '').trim() || `presentation-${Date.now()}.pptx`;

    try {
      const pres = new PptxGen();
      pres.layout = 'LAYOUT_WIDE'; // 13.33" × 7.5"

      // Title slide
      const titleSlide = pres.addSlide();
      titleSlide.background = themeConfig.background;
      titleSlide.addText(presTitle, {
        x: 0.5, y: 2.2, w: '90%', h: 1.8,
        fontSize: 40, bold: true, color: themeConfig.titleColor,
        align: 'center',
      });
      titleSlide.addText(`${slideItems.length} slide${slideItems.length !== 1 ? 's' : ''}`, {
        x: 0.5, y: 4.2, w: '90%', h: 0.5,
        fontSize: 18, color: themeConfig.bodyColor, align: 'center',
      });

      // Content slides
      for (const s of slideItems) {
        const slide = pres.addSlide();
        slide.background = themeConfig.background;
        const layout = s.layout ?? 'bullets';

        if (layout !== 'blank') {
          slide.addText(String(s.title ?? ''), {
            x: 0.5, y: 0.3, w: '90%', h: 0.9,
            fontSize: 28, bold: true, color: themeConfig.titleColor,
          });
        }

        if (layout === 'bullets' && s.bullets.length > 0) {
          const bulletObjs = s.bullets.map((b) => ({
            text: String(b),
            options: {
              bullet: { type: 'bullet' },
              fontSize: 18,
              color: themeConfig.bodyColor,
              breakLine: false,
            },
          }));
          slide.addText(bulletObjs, {
            x: 0.5, y: 1.4, w: '90%', h: 5.5,
            valign: 'top',
          });
        }
      }

      const buffer = await pres.write({ outputType: 'nodebuffer' });
      const resolved = await resolveSafe(filename);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, buffer);

      return {
        content: [
          `Presentation created: "${filename}"`,
          `Theme: ${rawTheme}`,
          `Slides: ${slideItems.length + 1} (title + ${slideItems.length} content slides)`,
          `Size: ${buffer.length} bytes`,
          `Format: PowerPoint (.pptx)`,
          '',
          'Open with Microsoft PowerPoint, LibreOffice Impress, or Google Slides.',
        ].join('\n'),
      };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
