import { type SkillDefinition } from '../skill';

/**
 * Color format conversion skill (no external dependencies).
 * Converts between HEX, RGB, and HSL color formats.
 */

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] | null {
  const cleaned = hex.replace(/^#/, '');
  let r: number, g: number, b: number;
  if (cleaned.length === 3) {
    r = parseInt(cleaned[0] + cleaned[0], 16);
    g = parseInt(cleaned[1] + cleaned[1], 16);
    b = parseInt(cleaned[2] + cleaned[2], 16);
  } else if (cleaned.length === 6) {
    r = parseInt(cleaned.slice(0, 2), 16);
    g = parseInt(cleaned.slice(2, 4), 16);
    b = parseInt(cleaned.slice(4, 6), 16);
  } else {
    return null;
  }
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return [r, g, b];
}

function parseRgb(input: string): [number, number, number] | null {
  // rgb(r, g, b) or "r g b" or "r,g,b"
  const m = input.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return null;
  const r = parseInt(m[1], 10);
  const g = parseInt(m[2], 10);
  const b = parseInt(m[3], 10);
  if ([r, g, b].some((v) => v < 0 || v > 255 || isNaN(v))) return null;
  return [r, g, b];
}

function parseHsl(input: string): [number, number, number] | null {
  // hsl(h, s%, l%) or "h s l"
  const m = input.match(/(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)%?[,\s]+(\d+(?:\.\d+)?)%?/);
  if (!m) return null;
  const h = parseFloat(m[1]);
  const s = parseFloat(m[2]);
  const l = parseFloat(m[3]);
  if (isNaN(h) || isNaN(s) || isNaN(l)) return null;
  if (h < 0 || h > 360 || s < 0 || s > 100 || l < 0 || l > 100) return null;
  return [h, s, l];
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / delta + 6) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h = Math.round(h * 60);
  }

  return [h, Math.round(s * 100), Math.round(l * 100)];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sn = s / 100, ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = ln - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// ---------------------------------------------------------------------------
// Skill
// ---------------------------------------------------------------------------

export const colorConvert: SkillDefinition = {
  name: 'colorConvert',
  description:
    'Converts a color value between HEX, RGB, and HSL formats (no external dependencies). ' +
    'Input can be a HEX code (e.g., "#ff6347" or "ff6347"), ' +
    'RGB values (e.g., "255 99 71" or "rgb(255,99,71)"), ' +
    'or HSL values (e.g., "9 100 64" or "hsl(9,100%,64%)"). ' +
    'Returns all three representations.',
  parameters: {
    type: 'object',
    properties: {
      color: {
        type: 'string',
        description: 'Color value to convert. Accepts HEX (#rrggbb or #rgb), RGB (e.g., "255,99,71"), or HSL (e.g., "9,100%,64%").',
      },
    },
    required: ['color'],
  },
  category: 'utility',
  riskLevel: 'low',
  handler: async (args) => {
    const input = String(args.color ?? '').trim();
    if (!input) return { content: 'Error: color is required', isError: true };

    let rgb: [number, number, number] | null = null;

    // Try HEX
    if (/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(input.replace(/\s/g, ''))) {
      rgb = parseHex(input);
    }
    // Try RGB (contains commas or spaces between numbers, no % signs expected for all three)
    if (!rgb && /\d/.test(input) && !input.includes('%')) {
      rgb = parseRgb(input);
    }
    // Try HSL (contains % or "hsl")
    if (!rgb) {
      const hslInput = input.replace(/hsl\s*\(\s*|\s*\)/gi, '');
      const hsl = parseHsl(hslInput);
      if (hsl) rgb = hslToRgb(...hsl);
    }
    // Fallback: try RGB again with % stripped
    if (!rgb) {
      rgb = parseRgb(input.replace(/%/g, ''));
    }

    if (!rgb) {
      return {
        content: `Error: could not parse color "${input}". Supported formats: #rrggbb, #rgb, "r,g,b", "h,s%,l%".`,
        isError: true,
      };
    }

    const [r, g, b] = rgb;
    const hex = rgbToHex(r, g, b);
    const [h, s, l] = rgbToHsl(r, g, b);

    const lines = [
      `🎨 Color: ${hex}`,
      `  HEX:  ${hex}`,
      `  RGB:  rgb(${r}, ${g}, ${b})`,
      `  HSL:  hsl(${h}, ${s}%, ${l}%)`,
    ];
    return { content: lines.join('\n') };
  },
};
