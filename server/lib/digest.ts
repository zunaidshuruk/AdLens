/**
 * Builds the text and HTML of the weekly summary email and the spike/drop alert email (Sprint 18).
 * Pure functions. Every value that came from outside (project names, domains) is HTML-escaped.
 */
import type { Anomaly } from './anomaly.js';

export interface DigestMetric { label: string; value: number; previousValue: number; changePercent: number | null; unit?: 'percent' | 'seconds' }

export interface DigestInput {
  projectName: string;
  domain: string;
  startDate: string;
  endDate: string;
  metrics: DigestMetric[];
  anomaly?: Anomaly | null;
  appUrl: string;
}

export interface BuiltEmail { subject: string; text: string; html: string }

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function fmt(m: DigestMetric): string {
  if (m.unit === 'percent') return `${(Math.round(m.value * 10) / 10).toString()}%`;
  if (m.unit === 'seconds') return m.value >= 60 ? `${Math.floor(m.value / 60)}m ${Math.round(m.value % 60)}s` : `${Math.round(m.value)}s`;
  return Math.round(m.value).toLocaleString('en-US');
}

function change(m: DigestMetric): string {
  if (m.changePercent === null || !Number.isFinite(m.changePercent)) return 'no comparison';
  const n = Math.round(m.changePercent * 10) / 10;
  return `${n > 0 ? '+' : ''}${n}% vs previous period`;
}

export function buildWeeklyDigest(input: DigestInput): BuiltEmail {
  const subject = `${input.projectName}: your weekly AdLens summary`;
  const lines = input.metrics.map((m) => `${m.label}: ${fmt(m)} (${change(m)})`);
  const text = [
    `${input.projectName} (${input.domain})`,
    `${input.startDate} to ${input.endDate}`,
    '',
    ...lines,
    ...(input.anomaly ? ['', alertSentence(input.anomaly)] : []),
    '',
    `Open AdLens: ${input.appUrl}`,
    '',
    'You get this because you turned on email summaries in AdLens. Turn them off under Settings, Email summaries.',
  ].join('\n');
  const rows = input.metrics
    .map((m) => `<tr><td style="padding:6px 12px 6px 0;color:#444">${escapeHtml(m.label)}</td><td style="padding:6px 12px 6px 0;font-weight:600">${escapeHtml(fmt(m))}</td><td style="padding:6px 0;color:#666">${escapeHtml(change(m))}</td></tr>`)
    .join('');
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17181b"><h2 style="margin:0 0 4px">${escapeHtml(input.projectName)}</h2><p style="margin:0 0 16px;color:#666">${escapeHtml(input.domain)} · ${escapeHtml(input.startDate)} to ${escapeHtml(input.endDate)}</p><table style="border-collapse:collapse">${rows}</table>${input.anomaly ? `<p style="margin-top:16px;padding:10px;border:1px solid #ddd;border-radius:8px">${escapeHtml(alertSentence(input.anomaly))}</p>` : ''}<p style="margin-top:20px"><a href="${escapeHtml(input.appUrl)}">Open AdLens</a></p><p style="color:#888;font-size:12px">You get this because you turned on email summaries. Turn them off under Settings, Email summaries.</p></div>`;
  return { subject, text, html };
}

export function alertSentence(a: Anomaly): string {
  const dir = a.direction === 'up' ? 'higher' : 'lower';
  return `Heads up: sessions on ${a.date} were ${Math.abs(a.changePercent)}% ${dir} than a typical day (${Math.round(a.value).toLocaleString('en-US')} against about ${Math.round(a.baseline).toLocaleString('en-US')}).`;
}

export function buildAnomalyAlert(input: Pick<DigestInput, 'projectName' | 'domain' | 'appUrl'> & { anomaly: Anomaly }): BuiltEmail {
  const word = input.anomaly.direction === 'up' ? 'spike' : 'drop';
  const subject = `${input.projectName}: traffic ${word} on ${input.anomaly.date}`;
  const sentence = alertSentence(input.anomaly);
  const text = `${input.projectName} (${input.domain})\n\n${sentence}\n\nSee what changed: ${input.appUrl}\n\nTurn these alerts off under Settings, Email summaries.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17181b"><h2 style="margin:0 0 4px">${escapeHtml(input.projectName)}</h2><p style="margin:0 0 16px;color:#666">${escapeHtml(input.domain)}</p><p>${escapeHtml(sentence)}</p><p><a href="${escapeHtml(input.appUrl)}">See what changed</a></p><p style="color:#888;font-size:12px">Turn these alerts off under Settings, Email summaries.</p></div>`;
  return { subject, text, html };
}
