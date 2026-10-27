import type { PageRow } from '../types/intelligence.js';
import { csvCell } from './exploreCsv.js';

const HEADER = ['Page', 'Title', 'Views', 'Users', 'Avg engagement (s)', 'Key events', 'Search clicks', 'Impressions', 'CTR %', 'Position', 'Notes'];

/** CSV of the Pages table. Page paths and titles come from the public web, so every cell goes through the formula-safe writer. */
export function pagesToCsv(rows: PageRow[]): string {
  const lines = [HEADER.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [r.path, r.title, r.views, r.users, r.avgEngagementSeconds, r.keyEvents, r.clicks, r.impressions, r.ctr, r.position, r.flags.join(' ')]
        .map((v) => csvCell(v as string | number | null))
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}
