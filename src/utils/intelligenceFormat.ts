/** Small display helpers shared by the Sprint 11 and 12 screens. */

export function pageDetailLink(path: string): string {
  return `/pages/detail?path=${encodeURIComponent(path)}`;
}

/** Reads and checks the ?path= value; anything that is not a plain page path is refused. */
export function readPathParam(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const p = raw.trim();
  if (!p.startsWith('/') || p.length > 300) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(p)) return null;
  return p;
}

export function shortUrl(url: string, max = 60): string {
  let s = url.replace(/^https?:\/\/(www\.)?/, '');
  if (s.endsWith('/')) s = s.slice(0, -1);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function trendPercentLabel(item: { changePercent: number | null; status: string }): string {
  if (item.status === 'new') return 'New';
  if (item.status === 'lost') return 'Lost';
  if (item.changePercent === null) return '—';
  const sign = item.changePercent > 0 ? '+' : '';
  return `${sign}${item.changePercent.toFixed(0)}%`;
}

/** Plain-language message for the errors these reports can raise. */
export function friendlyReportError(code: string | null | undefined, fallback: string): string {
  switch (code) {
    case 'GA4_NOT_SELECTED':
      return 'Choose a Google Analytics 4 property for this project on the Connections page.';
    case 'SC_NOT_SELECTED':
      return 'Choose a Search Console site for this project on the Connections page.';
    case 'META_NOT_CONNECTED':
      return 'Connect Facebook and choose an ad account on the Connections page to compare ads with website visits.';
    case 'GOOGLE_REAUTH_REQUIRED':
      return 'Your Google connection has expired. Reconnect Google on the Connections page.';
    case 'META_REAUTH_REQUIRED':
      return 'Your Facebook connection has expired. Reconnect Facebook on the Connections page.';
    default:
      return fallback;
  }
}

/** True when the fix is on the Connections page. */
export function needsConnection(code: string | null | undefined): boolean {
  return ['GA4_NOT_SELECTED', 'SC_NOT_SELECTED', 'META_NOT_CONNECTED', 'GOOGLE_REAUTH_REQUIRED', 'META_REAUTH_REQUIRED', 'GOOGLE_NOT_CONNECTED'].includes(code ?? '');
}

export function changeLabel(current: number, previous: number | undefined): string | null {
  if (previous === undefined || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}
