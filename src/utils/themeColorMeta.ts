/** Keeps the browser / phone status bar colour in step with the user's chosen theme. */

export interface MetaDoc {
  querySelectorAll(selector: string): ArrayLike<{ setAttribute(name: string, value: string): void }>;
  head?: { appendChild(node: unknown): unknown };
  createElement?(tag: string): { setAttribute(name: string, value: string): void };
}

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^(rgb|hsl|oklch)a?\([^)]{1,60}\)$/;

export function isSafeThemeColor(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 80 && COLOR_RE.test(value.trim());
}

/** Sets every theme-color tag to `color`. The two media-specific tags from index.html would otherwise ignore the user's theme. */
export function syncThemeColorMeta(doc: MetaDoc | null | undefined, color: unknown): boolean {
  if (!doc || !isSafeThemeColor(color)) return false;
  const tags = Array.from(doc.querySelectorAll('meta[name="theme-color"]'));
  if (tags.length === 0) {
    if (!doc.createElement || !doc.head) return false;
    const m = doc.createElement('meta');
    m.setAttribute('name', 'theme-color');
    m.setAttribute('content', color.trim());
    doc.head.appendChild(m);
    return true;
  }
  for (const t of tags) {
    t.setAttribute('content', color.trim());
    t.setAttribute('media', 'all'); // the user's own theme beats the phone's light/dark setting
  }
  return true;
}
