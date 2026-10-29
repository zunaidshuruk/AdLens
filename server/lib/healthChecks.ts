/**
 * Plain-words setup checklist for the owner's Settings page (Sprint 38). Only says whether things are set, never what the values are.
 * `required` items stop a feature working when missing; the others are optional extras.
 */
import type { ServerConfig } from '../config.js';

export interface HealthCheck { id: string; label: string; ok: boolean; required: boolean; fix: string }

export function buildHealthChecks(cfg: ServerConfig, env: Record<string, string | undefined> = process.env): HealthCheck[] {
  const has = (k: string) => Boolean(env[k]?.trim());
  const c = (id: string, label: string, ok: boolean, required: boolean, fix: string): HealthCheck => ({ id, label, ok, required, fix });
  return [
    c('firebase', 'Accounts and database (Firebase)', cfg.firebaseConfigured, true, `Set ${cfg.firebaseMissing.join(', ') || 'the FIREBASE_ variables'} on the server.`),
    c('google', 'Google sign-in and data (GA4, Search Console)', cfg.googleConfigured, true, `Set ${cfg.missing.join(', ') || 'the GOOGLE_ variables'} on the server.`),
    c('vault', 'Secure storage for connections', cfg.vaultReady, true, 'Set TOKEN_ENCRYPTION_KEY to a random string of at least 32 characters.'),
    c('baseurl', 'Public web address of the app', Boolean(cfg.appBaseUrl), true, 'Set APP_BASE_URL to the address people open, for example https://app.example.com.'),
    c('ai', 'Built-in AI (Gemini)', cfg.aiConfigured, false, 'Set GEMINI_API_KEY and GEMINI_MODEL to turn on the AI analyst, widget builder and SEO summaries.'),
    c('meta', 'Meta Ads connection', cfg.metaConfigured, false, `Set ${cfg.metaMissing.join(', ') || 'the META_ variables'} to turn on Facebook and Instagram ads.`),
    c('email', 'Email sending (Resend)', has('RESEND_API_KEY') && has('MAIL_FROM'), false, 'Set RESEND_API_KEY and MAIL_FROM. Needed for alerts, digests, scheduled snapshot emails and emailed PDFs.'),
    c('cron', 'Daily job secret', (env.CRON_SECRET?.trim().length ?? 0) >= 16, false, 'Set CRON_SECRET (16+ characters) and call POST /api/ops/run-digests once a day with it. Runs alerts, digests, share refresh and scheduled emails.'),
    c('store', 'Shared cache (Upstash)', has('UPSTASH_REDIS_REST_URL') && has('UPSTASH_REDIS_REST_TOKEN'), false, 'Optional. Without it each server copy keeps its own rate limits and cache.'),
    c('pagespeed', 'Speed test key (PageSpeed Insights)', has('PAGESPEED_API_KEY'), false, 'Optional but recommended. Without a key Google limits speed tests heavily. Create a free key in Google Cloud and turn on the PageSpeed Insights API.'),
    c('cse', 'Content brief search (Google Programmable Search)', has('GOOGLE_CSE_KEY') && has('GOOGLE_CSE_ID'), false, 'Optional and fine to skip. Lets the Content brief find ranking pages by itself, but Google no longer lets new search engines search the whole web and plans to end this API in 2027. Without it people paste competitor addresses.'),
    c('alerts', 'Error alerts', has('ERROR_WEBHOOK_URL'), false, 'Optional. Set ERROR_WEBHOOK_URL to be told when the server hits an error.'),
  ];
}
