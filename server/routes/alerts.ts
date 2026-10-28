import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { getContentLimits, getPlanFeatures } from '../config/plans.js';
import { getServerConfig } from '../config.js';
import { checkRule, deliver } from '../lib/alertRunner.js';
import { alertInputSchema, getAlertStore, publicRule, type StoredAlertRule } from '../lib/alertRules.js';
import { labelFor, measureRule, postJson } from '../lib/alertWiring.js';
import { getDataset, DatasetError } from '../lib/datasets.js';
import { getFirestoreStore } from '../lib/firestore.js';
import { sendMail } from '../lib/mailer.js';
import { can } from '../lib/permissions.js';
import { getProjectDocsStore } from '../lib/projectDocs.js';
import { sealAgentSecret, openAgentSecret } from '../lib/tokenVault.js';
import { getAgentKeyring } from '../lib/vault.js';
import { loadProject } from '../middleware/loadProject.js';
import { requireUser, verifyGoogleSessionOwnership } from '../middleware/requireUser.js';

/** Alert rules per project: "tell me when this number crosses a line". Evaluated by the daily job. */
export const alertsRouter = Router();

const fail = (res: Response, status: number, code: string, message: string): void => { res.status(status).json({ error: { code, message } }); };

alertsRouter.use(requireUser);
alertsRouter.use(verifyGoogleSessionOwnership);
alertsRouter.use(loadProject);

interface Scope { ws: string; project: string; plan: string | undefined; uid: string }
async function scope(req: Request, res: Response, write: boolean): Promise<Scope | null> {
  const project = req.project;
  if (!project) { fail(res, 400, 'PROJECT_REQUIRED', 'Choose a project first.'); return null; }
  const ws = await getFirestoreStore().getWorkspace(project.workspaceId);
  if (!ws || !can(ws, req.user!.uid, write ? 'content.edit' : 'reports.view')) {
    fail(res, 403, 'NOT_ALLOWED', 'You do not have permission to change alerts in this project.');
    return null;
  }
  return { ws: project.workspaceId, project: project.id, plan: ws.plan, uid: req.user!.uid };
}

const newId = () => randomBytes(9).toString('base64url');

async function validate(s: Scope, body: unknown, res: Response) {
  const parsed = alertInputSchema.safeParse(body);
  if (!parsed.success) { fail(res, 400, 'INVALID_ALERT', parsed.error.issues[0]?.message || 'The alert is not valid.'); return null; }
  const input = parsed.data;
  if (input.emails.length > 0 && !getPlanFeatures(s.plan).emailSummaries) {
    fail(res, 403, 'EMAIL_NOT_IN_PLAN', 'Email alerts are not part of your plan. Use a webhook (for example Slack) instead, or upgrade.');
    return null;
  }
  if (input.source === 'data') {
    try { await getDataset(getProjectDocsStore(), s.ws, s.project, input.datasetId ?? ''); } catch (e) {
      if (e instanceof DatasetError) { fail(res, 400, 'INVALID_ALERT', 'That uploaded table was not found.'); return null; }
      throw e;
    }
  }
  return input;
}

const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return undefined; } };

alertsRouter.get('/', async (req, res) => {
  try {
    const s = await scope(req, res, false);
    if (!s) return;
    const rules = (await getAlertStore().listForProject(s.ws, s.project)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ rules: rules.map(publicRule), limit: getContentLimits(s.plan).maxAlertRules, emailAllowed: getPlanFeatures(s.plan).emailSummaries, userEmail: req.user!.email ?? null });
  } catch { fail(res, 500, 'ALERTS_FAILED', 'Something went wrong with alerts.'); }
});

alertsRouter.post('/', async (req, res) => {
  try {
    const s = await scope(req, res, true);
    if (!s) return;
    const input = await validate(s, req.body, res);
    if (!input) return;
    const store = getAlertStore();
    const limit = getContentLimits(s.plan).maxAlertRules;
    if ((await store.listForProject(s.ws, s.project)).length >= limit) {
      return fail(res, 409, 'LIMIT_REACHED', `Your plan allows ${limit} ${limit === 1 ? 'alert' : 'alerts'} per project. Delete one or upgrade to add more.`);
    }
    const id = newId();
    const now = new Date().toISOString();
    const { webhookUrl, ...rest } = input;
    const rule: StoredAlertRule = {
      ...rest, id, workspaceId: s.ws, projectId: s.project, createdBy: s.uid, createdAt: now, updatedAt: now, status: 'new',
      ...(webhookUrl ? { sealedWebhook: sealAgentSecret(webhookUrl, s.uid, id, getAgentKeyring()), webhookHost: hostOf(webhookUrl) } : {}),
    };
    await store.put(rule);
    res.status(201).json({ rule: publicRule(rule) });
  } catch { fail(res, 500, 'ALERTS_FAILED', 'Could not save this alert.'); }
});

async function loadRule(req: Request, res: Response, s: Scope): Promise<StoredAlertRule | null> {
  const rule = await getAlertStore().get(String(req.params.id));
  if (!rule || rule.workspaceId !== s.ws || rule.projectId !== s.project) { fail(res, 404, 'NOT_FOUND', 'That alert was not found.'); return null; }
  return rule;
}

alertsRouter.put('/:id', async (req, res) => {
  try {
    const s = await scope(req, res, true);
    if (!s) return;
    const rule = await loadRule(req, res, s);
    if (!rule) return;
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    // webhookUrl left out = keep the saved one; empty text = remove it; a new address replaces it.
    const keepWebhook = body.webhookUrl === undefined && Boolean(rule.sealedWebhook);
    const input = await validate(s, keepWebhook ? { ...body, webhookUrl: 'https://placeholder.invalid/keep' } : body, res);
    if (!input) return;
    const { webhookUrl, ...rest } = input;
    const next: StoredAlertRule = { ...rule, ...rest, updatedAt: new Date().toISOString(), status: 'new' };
    delete next.lastError; delete next.lastMessage; delete next.lastValue;
    if (keepWebhook) { /* unchanged */ }
    else if (webhookUrl) { next.sealedWebhook = sealAgentSecret(webhookUrl, rule.createdBy, rule.id, getAgentKeyring()); next.webhookHost = hostOf(webhookUrl); }
    else { delete next.sealedWebhook; delete next.webhookHost; }
    if (keepWebhook && next.emails.length === 0 && !rule.sealedWebhook) return fail(res, 400, 'INVALID_ALERT', 'Choose where to send it.');
    await getAlertStore().put(next);
    res.json({ rule: publicRule(next) });
  } catch { fail(res, 500, 'ALERTS_FAILED', 'Could not save this alert.'); }
});

alertsRouter.delete('/:id', async (req, res) => {
  try {
    const s = await scope(req, res, true);
    if (!s) return;
    const rule = await loadRule(req, res, s);
    if (!rule) return;
    await getAlertStore().delete(rule.id);
    res.status(204).end();
  } catch { fail(res, 500, 'ALERTS_FAILED', 'Could not delete this alert.'); }
});

/** Checks the rule now and sends a clearly marked test message to its channels. Changes nothing about the rule. */
alertsRouter.post('/:id/test', async (req, res) => {
  try {
    const s = await scope(req, res, true);
    if (!s) return;
    const rule = await loadRule(req, res, s);
    if (!rule) return;
    const project = req.project!;
    const ctx = { projectName: project.name, emailAllowed: getPlanFeatures(s.plan).emailSummaries, metricLabel: await labelFor(rule) };
    const deps = {
      measure: measureRule,
      store: getAlertStore(),
      context: async () => ctx,
      webhookUrl: (r: StoredAlertRule) => { if (!r.sealedWebhook) return null; try { return openAgentSecret(r.sealedWebhook, r.createdBy, r.id, getAgentKeyring()); } catch { return null; } },
      sendMail, postWebhook: postJson, appUrl: getServerConfig().appBaseUrl,
    };
    let checked;
    try { checked = await checkRule(rule, ctx, deps, new Date()); } catch { return fail(res, 502, 'ALERT_CHECK_FAILED', 'Could not read the data for this alert. Check the connection.'); }
    const sentence = checked.sentence ?? 'There is no data for the last period yet.';
    const delivered = await deliver(rule, ctx, checked, deps, sentence, true);
    res.json({ delivered, wouldTrigger: checked.evaluation.triggered, value: checked.current, message: sentence });
  } catch { fail(res, 500, 'ALERTS_FAILED', 'Could not run the test.'); }
});
