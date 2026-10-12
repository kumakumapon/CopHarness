/**
 * Shared slide-parsing utility used by createSlideshow and createPresentation.
 */

export interface SlideItem {
  title: string;
  bullets: string[];
  notes?: string;
  layout?: string;
}

/**
 * Parse a JSON string into an array of slide objects.
 * Returns null when the input is empty, not valid JSON, or fails validation.
 * Each item must have a string "title" and an array "bullets";
 * "notes" (string) and "layout" (string) are optional.
 */
export function parseSlides(raw: unknown): SlideItem[] | null {
  const str = String(raw ?? '').trim();
  if (!str) return null;
  try {
    const parsed: unknown = JSON.parse(str);
    if (!Array.isArray(parsed)) return null;
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) return null;
      if (typeof (item as Record<string, unknown>).title !== 'string') return null;
      if (!Array.isArray((item as Record<string, unknown>).bullets)) return null;
    }
    return parsed as SlideItem[];
  } catch {
    return null;
  }
}
