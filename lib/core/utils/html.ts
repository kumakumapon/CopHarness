/**
 * Shared HTML utilities: stripHtml and escapeHtml.
 */

/**
 * Strip HTML tags and decode HTML entities from a string.
 * Uses multiple passes to handle nested/malformed tags
 * (e.g. "<scr<b>ipt>" is safely removed) and decodes numeric/named entities.
 */
export function stripHtml(html: string): string {
  // Remove HTML tags in multiple passes to handle nested/malformed tags
  // e.g. "<scr<b>ipt>" → "<script>" after first pass → "" after second pass
  let text = html;
  let prev = '';
  while (prev !== text) {
    prev = text;
    text = text.replace(/<[^>]*>/g, '');
  }
  // Decode HTML entities (order matters: &amp; last to prevent double-decoding)
  text = text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Escape special HTML characters in a plain-text string for safe inline insertion into HTML.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
