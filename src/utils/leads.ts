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
export function leadsToCsv(leads: LeadInfo[]): string {
  const head = ['Name', 'Website', 'Email', 'Phone', 'Status', 'Value', 'Follow up', 'Site check score', 'Notes'];
  const rows = leads.map((l) => [l.name, l.website, l.email, l.phone, LEAD_STATUS_LABEL[l.status], l.value, l.followUp, l.audit ? l.audit.score : '', l.notes].map(cell).join(','));
  return [head.join(','), ...rows].join('\r\n') + '\r\n';
}
