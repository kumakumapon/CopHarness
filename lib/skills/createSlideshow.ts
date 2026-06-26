import fs from 'node:fs/promises';
import path from 'node:path';
import { type SkillDefinition } from '../skill';
import { resolveSafe } from './fileSandbox';
import { escapeHtml } from '../utils/html';
import { parseSlides, type SlideItem as Slide } from '../utils/slides';

type Theme = 'light' | 'dark' | 'corporate';

const THEME_VARS: Record<Theme, string> = {
  light: [
    '--bg:#ffffff', '--fg:#1a1a1a', '--accent:#4f46e5',
    '--sub:#6b7280', '--notes-bg:rgba(0,0,0,0.88)', '--notes-fg:#ffffff',
  ].join('; '),
  dark: [
    '--bg:#1e1e2e', '--fg:#cdd6f4', '--accent:#cba6f7',
    '--sub:#a6adc8', '--notes-bg:rgba(255,255,255,0.08)', '--notes-fg:#cdd6f4',
  ].join('; '),
  corporate: [
    '--bg:#003366', '--fg:#ffffff', '--accent:#ff6b35',
    '--sub:rgba(255,255,255,0.65)', '--notes-bg:rgba(0,0,0,0.9)', '--notes-fg:#ffffff',
  ].join('; '),
};

function buildBulletDelaysCss(): string {
  return Array.from({ length: 12 }, (_, i) =>
    `.slide.active .bullets li:nth-child(${i + 1}) { transition-delay: ${((i + 1) * 0.1).toFixed(1)}s; }`
  ).join('\n  ');
}

function buildSlideshow(presTitle: string, slideItems: Slide[], theme: Theme): string {
  const themeVars = THEME_VARS[theme] ?? THEME_VARS.light;
  const total = slideItems.length + 1; // +1 for title slide

  const titleSlideHtml = [
    '<div class="slide active" id="slide-0">',
    '  <div class="slide-inner title-slide">',
    `    <h1 class="pres-title">${escapeHtml(presTitle)}</h1>`,
    `    <p class="slide-sub">${slideItems.length} slide${slideItems.length !== 1 ? 's' : ''}</p>`,
    '  </div>',
    '</div>',
  ].join('\n');

  const contentSlides = slideItems
    .map((s, i) => {
      const bulletsHtml = (Array.isArray(s.bullets) ? s.bullets : [])
        .map((b) => `      <li>${escapeHtml(String(b))}</li>`)
        .join('\n');
      return [
        `<div class="slide" id="slide-${i + 1}">`,
        '  <div class="slide-inner">',
        `    <h2 class="slide-title">${escapeHtml(String(s.title ?? ''))}</h2>`,
        `    <ul class="bullets">`,
        bulletsHtml,
        '    </ul>',
        '  </div>',
        '</div>',
      ].join('\n');
    })
    .join('\n\n');

  // Speaker notes per slide (index 0 = title slide has no notes)
  const notesData = JSON.stringify([
    '',
    ...slideItems.map((s) => String(s.notes ?? '')),
  ]);

  // Navigation JS — built via array.join to avoid TS template-literal conflicts
  const navJS = [
    'var allSlides = document.querySelectorAll(".slide");',
    'var counter = document.getElementById("counter");',
    'var notesPanel = document.getElementById("notes-panel");',
    'var notesText = document.getElementById("notes-text");',
    'var notesData = ' + notesData + ';',
    'var cur = 0;',
    '',
    'function goTo(n) {',
    '  if (n < 0 || n >= allSlides.length) return;',
    '  allSlides[cur].classList.remove("active");',
    '  allSlides[cur].classList.add("leaving");',
    '  var leaving = allSlides[cur];',
    '  setTimeout(function() { leaving.classList.remove("leaving"); }, 380);',
    '  cur = n;',
    '  allSlides[cur].classList.remove("leaving");',
    '  allSlides[cur].classList.add("active");',
    '  counter.textContent = (cur + 1) + " / " + allSlides.length;',
    '  notesText.textContent = notesData[cur] || "(no speaker notes)";',
    '}',
    '',
    'document.addEventListener("keydown", function(e) {',
    '  if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); goTo(cur + 1); }',
    '  else if (e.key === "ArrowLeft") { e.preventDefault(); goTo(cur - 1); }',
    '  else if (e.key === "Home") { goTo(0); }',
    '  else if (e.key === "End") { goTo(allSlides.length - 1); }',
    '  else if (e.key === "n" || e.key === "N") { notesPanel.classList.toggle("visible"); }',
    '  else if (e.key === "Escape") { notesPanel.classList.remove("visible"); }',
    '});',
    '',
    'document.getElementById("deck").addEventListener("click", function(e) {',
    '  var target = e.target;',
    '  if (target && typeof target.closest === "function" && target.closest("#notes-panel")) return;',
    '  goTo(cur + 1);',
    '});',
    '',
    'goTo(0);',
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(presTitle)}</title>
<style>
  :root { ${themeVars} }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow: hidden; height: 100vh; }
  #deck { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
  .slide {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; justify-content: center;
    padding: 3rem 5rem;
    opacity: 0; transform: translateX(60px);
    transition: opacity 0.35s ease, transform 0.35s ease;
    pointer-events: none;
  }
  .slide.active { opacity: 1; transform: translateX(0); pointer-events: all; }
  .slide.leaving { opacity: 0; transform: translateX(-60px); transition: opacity 0.35s ease, transform 0.35s ease; }
  .slide-inner { max-width: 1000px; width: 100%; }
  .title-slide { align-items: center; text-align: center; margin: 0 auto; }
  .pres-title { font-size: clamp(2rem, 5vw, 4rem); font-weight: 800; color: var(--accent); margin-bottom: 1rem; line-height: 1.2; }
  .slide-sub { font-size: 1.2rem; color: var(--sub); }
  .slide-title { font-size: clamp(1.4rem, 3vw, 2.2rem); font-weight: 700; color: var(--accent); margin-bottom: 1.5rem; }
  .bullets { list-style: none; display: flex; flex-direction: column; gap: 0.75rem; }
  .bullets li {
    font-size: clamp(1rem, 2vw, 1.35rem); padding-left: 2rem; position: relative;
    opacity: 0; transform: translateX(-18px);
    transition: opacity 0.4s ease, transform 0.4s ease;
  }
  .bullets li::before { content: "\\25B8"; position: absolute; left: 0; color: var(--accent); }
  ${buildBulletDelaysCss()}
  #footer {
    position: fixed; bottom: 0; left: 0; right: 0;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.6rem 1.5rem;
    font-size: 0.75rem; color: var(--sub);
    pointer-events: none;
  }
  #notes-panel {
    position: fixed; bottom: 0; left: 0; right: 0;
    background: var(--notes-bg); color: var(--notes-fg);
    padding: 1rem 2rem 1.5rem;
    transform: translateY(100%); transition: transform 0.3s ease;
    max-height: 35vh; overflow-y: auto;
    font-size: 1rem; line-height: 1.6;
    border-top: 1px solid rgba(128,128,128,0.3);
    pointer-events: all;
  }
  #notes-panel.visible { transform: translateY(0); }
  #notes-label { font-weight: 700; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.6; margin-bottom: 0.5rem; }
</style>
</head>
<body>
<div id="deck">
${titleSlideHtml}

${contentSlides}
</div>

<footer id="footer">
  <span id="counter">1 / ${total}</span>
  <span>← → / Space: navigate &nbsp;·&nbsp; N: notes &nbsp;·&nbsp; Esc: close notes</span>
</footer>

<div id="notes-panel">
  <div id="notes-label">&#128221; Speaker Notes</div>
  <p id="notes-text"></p>
</div>

<script>
${navJS}
</script>
</body>
</html>`;
}

export const createSlideshow: SkillDefinition = {
  name: 'createSlideshow',
  description:
    'Creates a self-contained HTML5 slide presentation and saves it to the sandbox directory. ' +
    'No external libraries or CDN dependencies — the output is a single portable HTML file. ' +
    'Accepts a JSON array of slides (each with "title", "bullets" array, and optional "notes"). ' +
    'Supports three visual themes: "light" (default), "dark", "corporate". ' +
    'Keyboard navigation: ← → or Space to advance, N to toggle speaker notes, Esc to close notes. ' +
    'Inspired by OpenClaw and Hermes Agent document generation patterns. ' +
    'Use for presentations, lecture slides, pitch decks, tutorials, and demos.',
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
          '[{"title":"Slide Title","bullets":["Point 1","Point 2"],"notes":"Optional speaker notes"},...] ' +
          'A title slide is automatically prepended.',
      },
      theme: {
        type: 'string',
        description: 'Visual theme: "light" (default, white bg), "dark" (dark purple), "corporate" (navy/orange).',
        enum: ['light', 'dark', 'corporate'],
      },
      filename: {
        type: 'string',
        description:
          'Output filename relative to the sandbox (must end in .html). ' +
          'Auto-generated as "slideshow-<timestamp>.html" if omitted.',
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
          '[{"title":"...","bullets":["..."],"notes":"optional"}]',
        isError: true,
      };
    }
    if (slideItems.length === 0) {
      return { content: 'Error: slides array must not be empty', isError: true };
    }

    const rawTheme = String(args.theme ?? 'light').trim().toLowerCase();
    const theme: Theme = ['light', 'dark', 'corporate'].includes(rawTheme)
      ? (rawTheme as Theme)
      : 'light';

    const filename = String(args.filename ?? '').trim() || `slideshow-${Date.now()}.html`;

    try {
      const html = buildSlideshow(presTitle, slideItems, theme);
      const resolved = await resolveSafe(filename);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, html, 'utf8');

      return {
        content: [
          `Slideshow created: "${filename}"`,
          `Theme: ${theme}`,
          `Slides: ${slideItems.length + 1} (title + ${slideItems.length} content slides)`,
          `Size: ${html.length} characters`,
          '',
          'Open the .html file in a browser to view.',
          'Keyboard: ← → / Space = navigate, N = speaker notes, Esc = close notes',
        ].join('\n'),
      };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
