/** Window / tab title for each screen. The installed app on Windows shows this in its title bar. */

const TITLES: [prefix: string, title: string][] = [
  ['/ai-analyst', 'AI Analyst'],
  ['/ai-traffic', 'AI Traffic'],
  ['/search-console', 'Search Console'],
  ['/meta-ads', 'Meta Ads'],
  ['/ga4', 'Google Analytics'],
  ['/explore', 'Explore'],
  ['/dashboards', 'Dashboards'],
  ['/connections', 'Connections'],
  ['/settings', 'Settings'],
  ['/agents', 'AI Agents'],
];

export function pageTitleFor(pathname: string, appName: string): string {
  const path = typeof pathname === 'string' ? pathname : '/';
  if (path === '/' || path === '') return `Overview · ${appName}`;
  for (const [prefix, title] of TITLES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return `${title} · ${appName}`;
  }
  return appName;
}
