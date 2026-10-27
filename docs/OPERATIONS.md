# AdLens — Operations guide (Sprints 15c, 17, 18, 19)

Everything here is optional. Nothing changes until you set the matching secret.

## Settings (AI Studio secrets)

| Secret | What it turns on |
|---|---|
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | One shared cache and rate-limit counter for every server copy (free Upstash Redis database, "REST" tab). Without them each copy keeps its own, which is fine for one instance. |
| `ERROR_WEBHOOK_URL` | Posts unexpected server errors to a Slack, Discord or Teams incoming webhook. Same error at most once per 5 minutes. Secrets are masked. |
| `OPERATOR_EMAILS` | Comma-separated emails allowed to see `GET /api/ops/usage` (how many Google and Meta calls AdLens made today). |
| `RESEND_API_KEY`, `MAIL_FROM` | Sends the weekly summary and spike/drop alerts (Resend.com; the sending domain must be verified there). |
| `CRON_SECRET` | At least 16 random characters. Protects the daily job address below. |
| `VITE_WEBLLM_MODULE_URL` | Build-time address of a self-hosted WebLLM file. Shows the optional "larger on-device model" choice in Private mode. Leave empty to hide it. |

## Daily job (email summaries and alerts)

Call this once a day, in the morning UTC (yesterday's numbers are complete by then):

```
POST https://YOUR-DOMAIN/api/ops/run-digests
Authorization: Bearer <CRON_SECRET>
```

Any scheduler works (Google Cloud Scheduler, a GitHub Actions `schedule:` workflow, cron-job.org). It is safe to call more often: a weekly summary needs 7 days since the last one and an alert is sent once per unusual day. The answer lists how many were sent.

## Uptime monitoring

Point your uptime monitor (UptimeRobot, Better Stack, ...) at `GET /api/ops/ready`. It answers 200 only when the server is up and its cache store works. `GET /api/health` shows which integrations are configured.

## Connecting AI tools (Sprint 17)

People create keys under **Connect AI tools** in the app. The address to give tools is `https://YOUR-DOMAIN/mcp`. Tools that sign in through a web page (Claude.ai connectors and similar) need only that address and use the approval screen at `/mcp-access/authorize`. Access is read-only, limited to the projects the person chose, and rate-limited to 60 calls a minute per key.

## Company single sign-on (Sprint 19)

1. **Upgrade Firebase Authentication to Identity Platform** (Firebase console → Authentication → "Upgrade"). This is a Google Cloud billing feature; check the current pricing for monthly active users first. It is needed for SAML, OpenID Connect and two-step verification.
2. In Firebase Authentication → Sign-in method, add the company's provider (SAML or OpenID Connect). The provider ID looks like `saml.okta` or `oidc.acme`. Give the company's administrator the return address shown in AdLens Settings → Security.
3. For two-step verification: Authentication → Settings → SMS/TOTP multi-factor → enable TOTP.
4. The workspace owner opens **Settings → Security → Company single sign-on**, enters the domain, provider ID and button name, adds the DNS TXT record shown, and presses "Check the record".
5. The owner signs out, signs in once with the company button, then switches on "Require single sign-on". (AdLens refuses to switch it on before that, so nobody locks themselves out.)

Rules the server enforces: a domain counts only after the DNS proof; public email domains cannot be claimed; a SAML or OpenID sign-in is accepted only for an email on the domain registered to that provider; people on a required domain who use a password or Google are refused with an explanation page.

"Sign out everywhere" (Settings → Security) revokes every session. Firebase does not list individual sessions, so AdLens offers this instead of a per-device list.

## Load test

`npx tsx scripts/load-test.ts https://YOUR-DOMAIN --seconds=20 --concurrency=20`. Public endpoints by default; authenticated paths count against the shared Google and Meta daily limits, so use a staging copy for those.

## Known limits

- Digest dates are UTC, not the project's time zone.
- An old browser tab that was open during a deploy may need a reload the first time it opens a screen it had not loaded yet (screens now load on demand).
- Subscription billing and plan limits for Enterprise are parked until the plans are decided.

## Plans and billing (Sprint 20)

There is no payment provider yet. A customer asks for an upgrade, pays you directly (bank, bKash, card link...), and you record it. Plans: Free, Pro, Business (and "Beta" for the early test workspaces). Limits live in `server/config/plans.ts`.

1. Put your own email in `OPERATOR_EMAILS` (the same setting as the usage view). Only those emails may use the operator calls below.
2. Upgrade requests arrive in the operator list (`GET /api/billing/admin/requests`) and, if `RESEND_API_KEY`, `MAIL_FROM` and `SUPPORT_EMAIL` are set, by email.
3. After payment: `POST /api/billing/admin/invoices` (invoice number, amount, BDT or USD, plan, period) and `POST /api/billing/admin/set-plan` (`workspaceId`, `plan`, `endsOn` = last paid day, optional `note`). Setting a paid plan closes the workspace's open request.
4. When `endsOn` passes there are 7 days of grace, then the workspace behaves as Free. Nothing is deleted: the workspace simply cannot add more than Free allows. Setting the plan again restores everything.
5. New workspaces start on `DEFAULT_NEW_WORKSPACE_PLAN` (currently `beta`, so nothing changes for anyone yet). Switch it to `free` when the plan screens are live.

The Admin page (`/admin`, sidebar "Admin", operators only) wraps these calls. To give another trusted person the Admin page, add their email to `OPERATOR_EMAILS` (comma-separated) and publish.

Team: Settings → Workspace → Team lets an owner add people by email, set roles (owner / admin / member) and offer colleagues with the same company email the chance to join. Each person uses their own Google and Meta connections. Refund policy: no refunds after 3 days.
