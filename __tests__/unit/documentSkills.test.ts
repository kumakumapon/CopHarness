/**
 * Unit tests for Phase 8: createDocument, createSlideshow, createPresentation skills.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { createDocument } from '../../lib/skills/createDocument';
import { createSlideshow } from '../../lib/skills/createSlideshow';
import { createPresentation } from '../../lib/skills/createPresentation';

// ---------------------------------------------------------------------------
// Shared sandbox setup
// ---------------------------------------------------------------------------

function makeSandbox() {
  let tmpDir = '';
  const savedSandbox = process.env.SKILL_FILE_SANDBOX_DIR;

  return {
    beforeEach: async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'copharness-doc-'));
      process.env.SKILL_FILE_SANDBOX_DIR = tmpDir;
    },
    afterEach: async () => {
      if (savedSandbox === undefined) delete process.env.SKILL_FILE_SANDBOX_DIR;
      else process.env.SKILL_FILE_SANDBOX_DIR = savedSandbox;
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
    dir: () => tmpDir,
  };
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe('document skill metadata', () => {
  it('createDocument has category "file" and riskLevel "medium"', () => {
    expect(createDocument.category).toBe('file');
    expect(createDocument.riskLevel).toBe('medium');
    expect(createDocument.parameters.required).toContain('title');
    expect(createDocument.parameters.required).toContain('sections');
  });

  it('createSlideshow has category "file" and riskLevel "medium"', () => {
    expect(createSlideshow.category).toBe('file');
    expect(createSlideshow.riskLevel).toBe('medium');
    expect(createSlideshow.parameters.required).toContain('title');
    expect(createSlideshow.parameters.required).toContain('slides');
  });

  it('createPresentation has category "file" and riskLevel "medium"', () => {
    expect(createPresentation.category).toBe('file');
    expect(createPresentation.riskLevel).toBe('medium');
    expect(createPresentation.parameters.required).toContain('title');
    expect(createPresentation.parameters.required).toContain('slides');
  });
});

// ---------------------------------------------------------------------------
// createDocument
// ---------------------------------------------------------------------------

describe('createDocument skill', () => {
  const sb = makeSandbox();
  beforeEach(sb.beforeEach);
  afterEach(sb.afterEach);

  const validSections = JSON.stringify([
    { heading: 'Introduction', content: 'This is the introduction.' },
    { heading: 'Summary', content: 'Final thoughts here.' },
  ]);

  it('creates a markdown file', async () => {
    const result = await createDocument.handler({ title: 'My Report', sections: validSections });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Document created');
    expect(result.content).toContain('Sections: 2');

    const files = await fs.readdir(sb.dir());
    expect(files.some((f) => f.endsWith('.md'))).toBe(true);
    const file = files.find((f) => f.endsWith('.md'))!;
    const content = await fs.readFile(path.join(sb.dir(), file), 'utf8');
    expect(content).toContain('# My Report');
    expect(content).toContain('## Introduction');
    expect(content).toContain('This is the introduction.');
  });

  it('creates an html file when format=html', async () => {
    const result = await createDocument.handler({
      title: 'HTML Doc', sections: validSections, format: 'html', filename: 'test.html',
    });
    expect(result.isError).toBeFalsy();
    const content = await fs.readFile(path.join(sb.dir(), 'test.html'), 'utf8');
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('HTML Doc');
    expect(content).toContain('Introduction');
    expect(content).toContain('Table of Contents');
  });

  it('uses custom filename when provided', async () => {
    await createDocument.handler({ title: 'T', sections: validSections, filename: 'custom.md' });
    const files = await fs.readdir(sb.dir());
    expect(files).toContain('custom.md');
  });

  it('returns error when title is missing', async () => {
    const result = await createDocument.handler({ sections: validSections });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/title is required/i);
  });

  it('returns error when sections is missing', async () => {
    const result = await createDocument.handler({ title: 'T' });
    expect(result.isError).toBe(true);
  });

  it('returns error for invalid sections JSON', async () => {
    const result = await createDocument.handler({ title: 'T', sections: 'not-json' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/invalid sections JSON/i);
  });

  it('returns error when sections is not an array', async () => {
    const result = await createDocument.handler({ title: 'T', sections: '{"heading":"h","content":"c"}' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/invalid sections JSON/i);
  });

  it('returns error for empty sections array', async () => {
    const result = await createDocument.handler({ title: 'T', sections: '[]' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/must not be empty/i);
  });

  it('rejects path traversal in filename', async () => {
    const result = await createDocument.handler({
      title: 'T', sections: validSections, filename: '../evil.md',
    });
    expect(result.isError).toBe(true);
  });

  it('HTML output escapes XSS in content', async () => {
    const xssSections = JSON.stringify([
      { heading: '<script>alert(1)</script>', content: '<b>bold</b>' },
    ]);
    await createDocument.handler({ title: 'XSS', sections: xssSections, format: 'html', filename: 'xss.html' });
    const html = await fs.readFile(path.join(sb.dir(), 'xss.html'), 'utf8');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ---------------------------------------------------------------------------
// createSlideshow
// ---------------------------------------------------------------------------

describe('createSlideshow skill', () => {
  const sb = makeSandbox();
  beforeEach(sb.beforeEach);
  afterEach(sb.afterEach);

  const validSlides = JSON.stringify([
    { title: 'Slide One', bullets: ['Point A', 'Point B'], notes: 'First slide notes' },
    { title: 'Slide Two', bullets: ['Point C', 'Point D'] },
  ]);

  it('creates a slideshow HTML file', async () => {
    const result = await createSlideshow.handler({ title: 'My Talk', slides: validSlides });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Slideshow created');
    expect(result.content).toContain('3 (title + 2');

    const files = await fs.readdir(sb.dir());
    expect(files.some((f) => f.endsWith('.html'))).toBe(true);
  });

  it('generated HTML contains navigation JS', async () => {
    await createSlideshow.handler({ title: 'T', slides: validSlides, filename: 'deck.html' });
    const html = await fs.readFile(path.join(sb.dir(), 'deck.html'), 'utf8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('ArrowRight');
    expect(html).toContain('Speaker Notes');
    expect(html).toContain('Slide One');
    expect(html).toContain('Point A');
  });

  it('includes speaker notes in the embedded data', async () => {
    await createSlideshow.handler({ title: 'T', slides: validSlides, filename: 'deck.html' });
    const html = await fs.readFile(path.join(sb.dir(), 'deck.html'), 'utf8');
    expect(html).toContain('First slide notes');
  });

  it('applies dark theme', async () => {
    await createSlideshow.handler({ title: 'T', slides: validSlides, theme: 'dark', filename: 'dark.html' });
    const html = await fs.readFile(path.join(sb.dir(), 'dark.html'), 'utf8');
    expect(html).toContain('1e1e2e');
  });

  it('applies corporate theme', async () => {
    await createSlideshow.handler({ title: 'T', slides: validSlides, theme: 'corporate', filename: 'corp.html' });
    const html = await fs.readFile(path.join(sb.dir(), 'corp.html'), 'utf8');
    expect(html).toContain('003366');
  });

  it('returns error when title is missing', async () => {
    const result = await createSlideshow.handler({ slides: validSlides });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/title is required/i);
  });

  it('returns error for invalid slides JSON', async () => {
    const result = await createSlideshow.handler({ title: 'T', slides: '{bad' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/invalid slides JSON/i);
  });

  it('returns error for empty slides array', async () => {
    const result = await createSlideshow.handler({ title: 'T', slides: '[]' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/must not be empty/i);
  });

  it('escapes HTML in slide titles and bullets', async () => {
    const xssSlides = JSON.stringify([{
      title: '<script>alert(1)</script>',
      bullets: ['<b>not bold</b>'],
    }]);
    await createSlideshow.handler({ title: 'XSS', slides: xssSlides, filename: 'xss.html' });
    const html = await fs.readFile(path.join(sb.dir(), 'xss.html'), 'utf8');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejects path traversal in filename', async () => {
    const result = await createSlideshow.handler({ title: 'T', slides: validSlides, filename: '../evil.html' });
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createPresentation
// ---------------------------------------------------------------------------

describe('createPresentation skill', () => {
  const sb = makeSandbox();
  beforeEach(sb.beforeEach);
  afterEach(sb.afterEach);

  const validSlides = JSON.stringify([
    { title: 'Slide One', bullets: ['Point A', 'Point B'] },
    { title: 'Slide Two', bullets: ['Point C'] },
  ]);

  it('returns error when title is missing', async () => {
    const result = await createPresentation.handler({ slides: validSlides });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/title is required/i);
  });

  it('returns error for invalid slides JSON', async () => {
    const result = await createPresentation.handler({ title: 'T', slides: 'bad' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/invalid slides JSON/i);
  });

  it('returns error for empty slides array', async () => {
    const result = await createPresentation.handler({ title: 'T', slides: '[]' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/must not be empty/i);
  });

  it('returns helpful error or success depending on pptxgenjs installation', async () => {
    const result = await createPresentation.handler({ title: 'Test', slides: validSlides });
    if (result.isError) {
      // pptxgenjs not installed — verify the message is actionable
      expect(result.content).toMatch(/pptxgenjs/i);
      expect(result.content).toMatch(/npm install/i);
    } else {
      // pptxgenjs installed — verify success
      expect(result.content).toContain('Presentation created');
      expect(result.content).toContain('.pptx');
    }
  });
});
