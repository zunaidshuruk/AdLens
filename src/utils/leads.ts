import type { LeadInfo } from '../api/client.js';

export const LEAD_STATUS_LABEL: Record<LeadInfo['status'], string> = { new: 'New', contacted: 'Contacted', meeting: 'Meeting set', proposal: 'Proposal sent', won: 'Won', lost: 'Lost' };
const OPEN: LeadInfo['status'][] = ['new', 'contacted', 'meeting', 'proposal'];

export function pipelineSummary(leads: Pick<LeadInfo, 'status' | 'value'>[]): { open: number; openValue: number; won: number; wonValue: number; lost: number; winRate: number | null } {
  let open = 0; let openValue = 0; let won = 0; let wonValue = 0; let lost = 0;
  for (const l of leads) {
    if (OPEN.includes(l.status)) { open++; openValue += l.value; } else if (l.status === 'won') { won++; wonValue += l.value; } else lost++;
  }
  return { open, openValue, won, wonValue, lost, winRate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null };
}

/** Leads with a follow-up date today or earlier that are still open. */
export const dueFollowUps = (leads: LeadInfo[], today: string): LeadInfo[] => leads.filter((l) => l.followUp && l.followUp <= today && OPEN.includes(l.status)).sort((a, b) => a.followUp.localeCompare(b.followUp));

// A cell starting with = + - or @ can run as a formula when the file is opened in a spreadsheet.
const cell = (v: string | number) => { const s = String(v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
export function leadsToCsv(leads: LeadInfo[], names?: Map<string, string>): string {
  const head = ['Name', 'Website', 'Email', 'Phone', 'Status', 'Value', 'Follow up', 'Site check score', 'Assigned to', 'Notes'];
  const rows = leads.map((l) => [l.name, l.website, l.email, l.phone, LEAD_STATUS_LABEL[l.status], l.value, l.followUp, l.audit ? l.audit.score : '', names?.get(l.assigneeId) ?? '', l.notes].map(cell).join(','));
  return [head.join(','), ...rows].join('\r\n') + '\r\n';
}

/** Reads CSV text (quotes, commas and line breaks inside quotes, Excel's byte-order mark) into rows keyed by the header names. */
export function parseCsv(input: string, delimiter = ','): Record<string, string>[] {
  const text = input.replace(/^\uFEFF/, '');
  const table: string[][] = [];
  let row: string[] = []; let cur = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false; } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; table.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length > 0) { row.push(cur); table.push(row); }
  const rows = table.filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length < 2) return [];
  const head = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((r) => { const o: Record<string, string> = {}; head.forEach((h, i) => { if (h && r[i] !== undefined && r[i]!.trim() !== '') o[h] = r[i]!.trim(); }); return o; }).filter((o) => Object.keys(o).length > 0);
}

/** Reads pasted rows, whether copied from a spreadsheet (tab-separated) or comma-separated. */
export function parsePasted(input: string): Record<string, string>[] {
  const firstLine = input.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/, 1)[0] ?? '';
  return parseCsv(input, firstLine.includes('\t') ? '\t' : ',');
}

/** Leads as tab-separated text. Pasting it into Google Sheets or Excel puts each value in its own cell. */
export function leadsToTsv(leads: LeadInfo[], names?: Map<string, string>): string {
  const clean = (v: string | number) => { const s = String(v).replace(/[\t\r\n]+/g, ' ').trim(); return /^[=+\-@]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s) ? `'${s}` : s; };
  const head = ['Name', 'Website', 'Email', 'Phone', 'Status', 'Value', 'Follow up', 'Assigned to', 'Notes'];
  return [head, ...leads.map((l) => [l.name, l.website, l.email, l.phone, LEAD_STATUS_LABEL[l.status], l.value, l.followUp, names?.get(l.assigneeId) ?? '', l.notes])].map((r) => r.map(clean).join('\t')).join('\n');
}
