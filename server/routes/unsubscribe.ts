import { Router, type Request, type Response } from 'express';
import { escapeHtml } from '../lib/digest.js';
import { getDigestStore } from '../lib/digestStore.js';
import { readUnsubscribe } from '../lib/unsubscribe.js';

/** Public (no sign-in): the link in every summary email. GET shows a confirm button (so mail scanners that open links cannot unsubscribe
 *  anyone by accident); POST does it (mail apps' one-click button posts here too). */
export const unsubscribeRouter = Router();

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head><body style="font-family:Arial,sans-serif;max-width:480px;margin:60px auto;padding:0 16px;color:#17181b"><h2>${escapeHtml(title)}</h2>${body}</body></html>`;

unsubscribeRouter.get('/', (req: Request, res: Response) => {
  const subId = readUnsubscribe(req.query.s, req.query.t);
  res.setHeader('Cache-Control', 'no-store');
  if (!subId) { res.status(400).type('html').send(page('This link is not valid', '<p>The link may be incomplete. You can turn summaries off in AdLens under Settings, Email summaries.</p>')); return; }
  const action = `/api/unsubscribe?s=${encodeURIComponent(String(req.query.s))}&t=${encodeURIComponent(String(req.query.t))}`;
  res.type('html').send(page('Stop these emails?', `<p>You will no longer get the weekly summary and alerts for this project.</p><form method="post" action="${escapeHtml(action)}"><button type="submit" style="padding:10px 18px;font-size:16px;border:0;border-radius:8px;background:#17181b;color:#fff;cursor:pointer">Unsubscribe</button></form>`));
});

unsubscribeRouter.post('/', async (req: Request, res: Response) => {
  const subId = readUnsubscribe(req.query.s, req.query.t);
  res.setHeader('Cache-Control', 'no-store');
  if (!subId) { res.status(400).type('html').send(page('This link is not valid', '<p>The link may be incomplete.</p>')); return; }
  await getDigestStore().delete(subId).catch(() => undefined);
  res.type('html').send(page('You are unsubscribed', '<p>You will not get these emails any more. You can turn them back on any time in AdLens under Settings, Email summaries.</p>'));
});
