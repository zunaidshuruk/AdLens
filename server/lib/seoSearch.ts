/** Optional: finds the pages that rank for a keyword through Google Programmable Search (free for 100 searches a day). */
export type SearchFn = (query: string) => Promise<string[] | null>;

export const cseSearch: SearchFn = async (query) => {
  const key = process.env.GOOGLE_CSE_KEY?.trim();
  const cx = process.env.GOOGLE_CSE_ID?.trim();
  if (!key || !cx) return null; // not set up: the screen asks for competitor addresses instead
  try {
    const u = new URL('https://www.googleapis.com/customsearch/v1');
    u.searchParams.set('key', key); u.searchParams.set('cx', cx); u.searchParams.set('q', query); u.searchParams.set('num', '8');
    const res = await fetch(u, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: { link?: string }[] };
    return (json.items ?? []).map((i) => i.link).filter((l): l is string => typeof l === 'string' && /^https:\/\//.test(l));
  } catch { return []; }
};
