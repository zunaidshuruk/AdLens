/**
 * Scheduled snapshot emails (Sprint 35): a dashboard or saved report, emailed weekly (Mondays) or monthly (the 1st).
 * The email carries the same server-made snapshot as a share link: big numbers and short tables (charts stay in the app).
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getPlanFeatures } from '../config/plans.js';
import { escapeHtml } from './digest.js';
import type { ExploreCell, ExploreResult } from './exploreSpec.js';
import { getAdminFirestore, getFirestoreStore } from './firestore.js';
import type { MailMessage, MailResult } from './mailer.js';
import { activeBrand } from './branding.js';
import { snapshotToPdf } from './pdf.js';
import { formatCell } from './snapshotFormat.js';
import { snapshotForTarget } from './shareWiring.js';
import type { Snapshot } from './shares.js';

export const emailScheduleInputSchema = z.object({
  kind: z.enum(['dashboard', 'report']),
  targetId: z.string().min(1).max(60).regex(/^[A-Za-z0-9_-]+$/),
  frequency: z.enum(['weekly', 'monthly']),
  rangeDays: z.union([z.literal(7), z.literal(28), z.literal(90)]).default(7),
  emails: z.array(z.string().trim().toLowerCase().email().max(120)).min(1, 'Add at least one email address').max(3, 'Up to 3 email addresses'),
  enabled: z.boolean().default(true),
  attachPdf: z.boolean().default(false),
});
export type EmailScheduleInput = z.infer<typeof emailScheduleInputSchema>;

export interface StoredSchedule extends EmailScheduleInput {
  id: string;
  workspaceId: string;
  projectId: string;
  createdBy: string;
  createdAt: string;
  title: string;
  lastSentAt?: string;
  lastError?: string;
}

export interface ScheduleStore {
  listAll(): Promise<StoredSchedule[]>;
  listForProject(ws: string, project: string): Promise<StoredSchedule[]>;
  get(id: string): Promise<StoredSchedule | null>;
  put(s: StoredSchedule): Promise<void>;
  delete(id: string): Promise<boolean>;
}
export function createInMemoryScheduleStore(): ScheduleStore {
  const map = new Map<string, StoredSchedule>();
  return {
    async listAll() { return [...map.values()].map((r) => structuredClone(r)); },
    async listForProject(ws, p) { return [...map.values()].filter((r) => r.workspaceId === ws && r.projectId === p).map((r) => structuredClone(r)); },
    async get(id) { const r = map.get(id); return r ? structuredClone(r) : null; },
    async put(r) { map.set(r.id, structuredClone(r)); },
    async delete(id) { return map.delete(id); },
  };
}
const col = () => getAdminFirestore().collection('emailSchedules');
const firestoreStore: ScheduleStore = {
  async listAll() { return (await col().get()).docs.map((d) => d.data() as StoredSchedule); },
  async listForProject(ws, p) { return (await col().where('workspaceId', '==', ws).where('projectId', '==', p).get()).docs.map((d) => d.data() as StoredSchedule); },
  async get(id) { const s = await col().doc(id).get(); return s.exists ? (s.data() as StoredSchedule) : null; },
  async put(r) { await col().doc(r.id).set(r); },
  async delete(id) { const ref = col().doc(id); const s = await ref.get(); if (!s.exists) return false; await ref.delete(); return true; },
};
let override: ScheduleStore | null = null;
export function setTestScheduleStore(s: ScheduleStore | null): void { override = s; }
export function getScheduleStore(): ScheduleStore { return override ?? firestoreStore; }
export const newScheduleId = () => randomBytes(9).toString('base64url');

/** Weekly goes out on Mondays (UTC), monthly on the 1st, once per period. */
export function isDue(s: Pick<StoredSchedule, 'frequency' | 'lastSentAt' | 'enabled'>, now = new Date()): boolean {
  if (!s.enabled) return false;
  const today = now.toISOString().slice(0, 10);
  if (s.lastSentAt?.slice(0, 10) === today) return false;
  if (s.frequency === 'weekly') return now.getUTCDay() === 1;
  return now.getUTCDate() === 1 && s.lastSentAt?.slice(0, 7) !== today.slice(0, 7);
}

const cell = formatCell;

const ROWS_IN_EMAIL = 10;
function widgetBlock(w: Snapshot['widgets'][number]): { html: string; text: string } {
  const head = `<h3 style="margin:18px 0 6px;font-size:15px">${escapeHtml(w.title)}</h3>`;
  if (w.kind === 'text') return { html: `${head}<p style="margin:0;white-space:pre-wrap">${escapeHtml(w.text ?? '')}</p>`, text: `${w.title}\n${w.text ?? ''}` };
  if (w.error || !w.result) return { html: `${head}<p style="margin:0;color:#888">Could not load this panel.</p>`, text: `${w.title}\nCould not load this panel.` };
  const r: ExploreResult = w.result;
  const metric = r.columns.find((c) => c.role === 'metric');
  if ((w.kind === 'kpi' || w.kind === 'gauge') && metric) {
    const row = r.totals ?? r.rows[0];
    const v = cell(row?.[metric.key], metric.type);
    return { html: `${head}<p style="margin:0;font-size:26px;font-weight:bold">${escapeHtml(v)}</p><p style="margin:0;color:#888;font-size:12px">${escapeHtml(metric.label)}</p>`, text: `${w.title}: ${v} (${metric.label})` };
  }
  if (r.rows.length === 0) return { html: `${head}<p style="margin:0;color:#888">No data for these dates.</p>`, text: `${w.title}\nNo data for these dates.` };
  const rows = r.rows.slice(0, ROWS_IN_EMAIL);
  const th = r.columns.map((c) => `<th align="${c.role === 'metric' ? 'right' : 'left'}" style="padding:4px 8px;border-bottom:1px solid #ddd;font-size:12px;color:#666">${escapeHtml(c.label)}</th>`).join('');
  const body = rows.map((row) => `<tr>${r.columns.map((c) => `<td align="${c.role === 'metric' ? 'right' : 'left'}" style="padding:4px 8px;border-bottom:1px solid #eee;font-size:13px">${escapeHtml(cell(row[c.key], c.type))}</td>`).join('')}</tr>`).join('');
  const more = r.rows.length > rows.length ? `<p style="margin:4px 0 0;color:#888;font-size:12px">Showing ${rows.length} of ${r.rows.length} rows. Open the live report for the rest.</p>` : '';
  const text = `${w.title}\n${rows.map((row) => r.columns.map((c) => cell(row[c.key], c.type)).join(' | ')).join('\n')}`;
  return { html: `${head}<table cellspacing="0" style="border-collapse:collapse;width:100%"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>${more}`, text };
}

export function buildScheduleEmail(s: Pick<StoredSchedule, 'title' | 'frequency' | 'kind' | 'targetId'>, snap: Snapshot, projectName: string, appUrl: string, ownerEmail: string, test = false, brand: { name: string; footer: string; accent: string | null } | null = null): Omit<MailMessage, 'to'> {
  const base = appUrl.replace(/\/+$/, '');
  const link = s.kind === 'dashboard' ? `${base}/dashboards/${s.targetId}` : `${base}/explore`;
  const blocks = snap.widgets.map(widgetBlock);
  const period = `${snap.range.startDate} to ${snap.range.endDate}`;
  const subject = `${test ? 'Test: ' : ''}${s.title} · ${s.frequency === 'weekly' ? 'weekly' : 'monthly'} snapshot (${projectName})`;
  const who = brand ? brand.name : 'AdLens';
  const foot = `Sent by ${who} because ${ownerEmail} scheduled it. To stop it, open ${s.kind === 'dashboard' ? 'the dashboard' : 'the report'} in ${brand ? 'the app' : 'AdLens'}, choose Share, and turn off the email.${brand?.footer ? ` ${brand.footer}` : ''}`;
  const accent = brand?.accent ?? '#17181b';
  const banner = brand ? `<p style="margin:0 0 10px;padding-bottom:8px;border-bottom:3px solid ${accent};font-weight:bold;font-size:16px;color:${accent}">${escapeHtml(brand.name)}</p>` : '';
  const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#17181b">${banner}<h2 style="margin:0 0 2px">${escapeHtml(s.title)}</h2><p style="margin:0 0 4px;color:#666">${escapeHtml(projectName)} · ${escapeHtml(period)}</p>${test ? '<p style="color:#b45309">This is a test email.</p>' : ''}${blocks.map((b) => b.html).join('')}<p style="margin-top:20px"><a href="${escapeHtml(link)}">${brand ? 'Open the live report' : 'Open in AdLens'}</a></p><p style="color:#888;font-size:12px">${escapeHtml(foot)}</p></div>`;
  const text = [`${s.title} — ${projectName} (${period})`, ...(test ? ['This is a test email.'] : []), ...blocks.map((b) => b.text), `${brand ? 'Open the live report' : 'Open in AdLens'}: ${link}`, ...(brand ? [brand.name] : []), foot].join('\n\n');
  return { subject, html, text };
}

/** A safe file name such as board-2026-10-26.pdf. */
export function pdfName(title: string, snap: { range: { endDate: string } }): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'snapshot';
  return `${base}-${snap.range.endDate}.pdf`;
}

export interface RunSchedulesDeps {
  store: ScheduleStore;
  now?: Date;
  appUrl: string;
  sendMail(m: MailMessage): Promise<MailResult>;
  /** Null when the schedule should be dropped (project or owner gone). */
  context(s: StoredSchedule): Promise<{ projectName: string; ownerEmail: string; emailAllowed: boolean; brand?: { name: string; footer: string; accent: string | null } | null } | null>;
  snapshot(s: StoredSchedule, now: Date): Promise<{ title: string; snapshot: Snapshot }>;
  force?: boolean;
}

export async function runEmailSchedules(deps: RunSchedulesDeps): Promise<{ checked: number; sent: number; failed: number; removed: number }> {
  const now = deps.now ?? new Date();
  const all = await deps.store.listAll();
  const out = { checked: all.length, sent: 0, failed: 0, removed: 0 };
  for (const s of all) {
    if (!deps.force && !isDue(s, now)) continue;
    const ctx = await deps.context(s);
    if (!ctx) { await deps.store.delete(s.id); out.removed++; continue; }
    if (!ctx.emailAllowed) continue;
    try {
      const { title, snapshot } = await deps.snapshot(s, now);
      const mail = buildScheduleEmail({ ...s, title }, snapshot, ctx.projectName, deps.appUrl, ctx.ownerEmail, false, ctx.brand ?? null);
      const attachments = s.attachPdf ? [{ filename: pdfName(title, snapshot), content: snapshotToPdf(snapshot, ctx.projectName, ctx.brand ?? null) }] : undefined;
      let ok = 0;
      for (const to of s.emails) if ((await deps.sendMail({ ...mail, to, ...(attachments ? { attachments } : {}) })).ok) ok++;
      if (ok > 0) { await deps.store.put({ ...s, title, lastSentAt: now.toISOString(), lastError: undefined }); out.sent++; }
      else { await deps.store.put({ ...s, lastError: 'The email could not be sent.' }); out.failed++; }
    } catch {
      await deps.store.put({ ...s, lastError: 'Could not read the data for this email.' });
      out.failed++;
    }
  }
  return out;
}

export async function productionScheduleContext(s: StoredSchedule) {
  const fs = getFirestoreStore();
  const ws = await fs.getWorkspace(s.workspaceId);
  if (!ws?.members || !Object.prototype.hasOwnProperty.call(ws.members, s.createdBy)) return null;
  const project = await fs.getProject(s.workspaceId, s.projectId);
  if (!project) return null;
  const owner = await fs.getUser(s.createdBy).catch(() => null);
  return { projectName: project.name, ownerEmail: (owner as { email?: string } | null)?.email ?? 'a member of your workspace', emailAllowed: getPlanFeatures(ws.plan).emailSummaries, brand: activeBrand(ws) };
}
export const productionSnapshot = (s: StoredSchedule, now: Date) => snapshotForTarget({ ...s, ownerUid: s.createdBy }, undefined, now);
