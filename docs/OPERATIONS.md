# AdLens — Operations guide (Sprints 15c, 17, 18, 19)

Everything here is optional. Nothing changes until you set the matching secret.

## Settings (AI Studio secrets)

| Secret | What it turns on |
|---|---|
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | One shared cache and rate-limit counter for every server copy (free Upstash Redis database, "REST" tab). Without them each copy keeps its own, which is fine for one instance. |
| `ERROR_WEBHOOK_URL` | Posts unexpected server errors to a Slack, Discord or Teams incoming webhook. Same error at most once per 5 minutes. Secrets are masked. |
| `OPERATOR_EMAILS` | Comma-separated emails allowed to see `GET /api/ops/usage` (how many Google and Meta calls AdLens made today). |
| `RESEND_API_KEY`, `MAIL_FROM` | Sends the weekly summary and spike/drop alerts (Resend.com; the sending domain must be verified there). |
| `DEFAULT_NEW_WORKSPACE_PLAN` | The plan new sign-ups start on. Default `free`. Set `beta`, `pro` or `business` and redeploy to change it. Existing workspaces never change. |
| `CRON_SECRET` | At least 16 random characters. Protects the daily job address below. |
| `PAGESPEED_API_KEY` | Optional but recommended. A free key for Google's PageSpeed Insights, used by the SEO Speed test tab. Create it in Google Cloud: APIs & Services, turn on "PageSpeed Insights API", then Credentials, Create API key (restrict it to that API). Without a key Google allows very few tests and the tab shows a "busy" message. |
| `GOOGLE_CSE_KEY` and `GOOGLE_CSE_ID` | Optional and fine to skip: Google no longer offers a whole-web option to new search engines and plans to end the Custom Search API in 2027 (from third-party reports; Google's own announcement could not be read). Lets the SEO Content brief find the top pages for a keyword by itself. Create a Programmable Search Engine at programmablesearchengine.google.com that searches the whole web (copy its ID), then create an API key in Google Cloud with the "Custom Search API" turned on. 100 searches a day are free. Without them people paste up to 5 competitor addresses instead. |
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
3. Two-step verification for customers does not need this: AdLens has its own authenticator-app two-step (Settings → Security), free. Firebase's own SMS/TOTP multi-factor is only needed for company single sign-on rules that demand it.
4. The workspace owner opens **Settings → Security → Company single sign-on**, enters the domain, provider ID and button name, adds the DNS TXT record shown, and presses "Check the record".
5. The owner signs out, signs in once with the company button, then switches on "Require single sign-on". (AdLens refuses to switch it on before that, so nobody locks themselves out.)

Rules the server enforces: a domain counts only after the DNS proof; public email domains cannot be claimed; a SAML or OpenID sign-in is accepted only for an email on the domain registered to that provider; people on a required domain who use a password or Google are refused with an explanation page.

"Sign out everywhere" (Settings → Security) revokes every session. Firebase does not list individual sessions, so AdLens offers this instead of a per-device list.

## Protection against floods (Sprint 24)

Built into the server, no extra service needed. Each running copy of the server counts for itself. Defaults (change with settings, all optional):

| Setting | Default | What it limits |
|---|---|---|
| `RATE_LIMIT_IP_PER_MIN` | 1200 | API requests per address per minute (IPv6 grouped by network) |
| `RATE_LIMIT_STATIC_PER_MIN` | 3000 | page and file requests per address per minute |
| `RATE_LIMIT_USER_PER_MIN` | 300 | requests per signed-in person per minute |
| `RATE_LIMIT_BAD_TOKEN_PER_MIN` | 40 | rejected sign-in tokens per address per minute before the address is paused |
| `MAX_IN_FLIGHT_REQUESTS` | 500 | API requests handled at once per server copy, then "busy" (503) |
| `REQUEST_DEADLINE_SECONDS` / `REQUEST_LONG_DEADLINE_SECONDS` | 55 / 120 | give-up time for normal / AI requests |
| `TRUST_PROXY` | 1 | how many proxies sit in front of the server. Wrong value = everyone looks like one address (or the attacker can fake theirs). Use the number of proxies between the internet and the server. |

Health checks (`/api/health`, `/api/ops/ready`) are never refused. Slow connections are cut off (headers within 15 s, whole request within about 2 minutes).
This is not a replacement for network-level protection: **the app is not hosted on Vercel, so put a CDN or load balancer with DDoS protection in front** (Cloudflare free plan, or Google Cloud Armor if on Cloud Run). Without it, a large flood can still use up bandwidth before the app sees it.

## Summary emails: unsubscribe

Every summary and alert email has an "Unsubscribe" link and the standard one-click header. The link is signed with a key derived from `TOKEN_ENCRYPTION_KEY`, so changing that key (without keeping the old one) makes old links stop working; people can still turn emails off in Settings.

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

The admin panel has its own address, `/admin-login` (it is not in the customer menu). Sign in there with Google only (email and password is refused for the panel); turn on 2-Step Verification in that Google account. That opens a one-hour admin session; after an hour it asks for a fresh sign-in. Operators are the emails in `OPERATOR_EMAILS` (owners, cannot be removed from the screen) plus emails added on the panel's Operators tab.

On the panel, without touching code or Secrets: **Plans and prices** (every limit, USD and BDT price, history days, email summaries; "Put back the shipped numbers"; private plans for one customer, for example "Convay team"), **Switches** (pause new sign-ups, maintenance mode with a message, turn Explore, Dashboards, AI agents, AI tools, AI Analyst or Teams off), **Operators**, **Workspaces** (set plan and end date, record payments, people), **Upgrade requests**, **Users**, **Activity**. Settings live in the server-only Firestore document `adminSettings/config` and reach every server within 30 seconds. Every change is written to the activity log.

Team and roles: Settings → Workspace → Team lets people with the "Add and remove people" permission add people by email, and people with "Create roles and assign them" choose each person's role. Starter roles: Owner (everything, one per workspace), Admin (everything else), Moderator (content, agents and people, but not settings, plans or roles), Member (works with the data). The workspace's admins can also make custom roles under Settings → Workspace → Roles and permissions by ticking permissions. Nobody can give out, or take away, more access than they have themselves, and the owner can never be changed or removed. Each person uses their own Google and Meta connections.

AdLens staff roles (admin panel → Staff): Super admin (everything, including staff), Billing manager (plans, payments, upgrade requests, subscriptions), Support (look things up and manage people in a customer's workspace), Settings manager (plan limits, prices, switches). The emails in `OPERATOR_EMAILS` are always Super admins and cannot be changed on the screen. Staff added before roles existed count as Super admins. Refund policy: no refunds after 3 days.

## Email: making sure messages arrive

AdLens sends two kinds of email. **Account emails** (confirm your email, reset your password) and **everything else** (alerts, weekly summaries, scheduled report emails, emailed PDFs, upgrade requests). Since Sprint 51 both go through your own sender (Resend); if it is not set up, account emails fall back to Firebase's built-in sender, which many inboxes drop or put in spam. The reliable fix is to set up Resend once:

1. Create a free account at resend.com. Under **Domains** add a domain you own (for example `mail.yourdomain.com`) and add the DNS records it shows (SPF, DKIM). Wait until it says **Verified**. A sender on an unverified domain is refused.
2. Under **API Keys** create a key with "Sending access".
3. In the server settings (AI Studio environment variables) add `RESEND_API_KEY` (the key) and `MAIL_FROM` (for example `AdLens <hello@mail.yourdomain.com>`; the address must be on the verified domain). Redeploy.
4. In the app open **Settings, Preferences, Email delivery check** and press **Send me a test email**. It says plainly what is missing or what Resend refused.
5. Also make sure Firebase accepts your site's address: Firebase console, Authentication, Settings, **Authorized domains** must list your live domain.

Check the spam folder of the receiving inbox too, and for company mailboxes ask IT to allow your sending domain. Account emails are limited to 6 confirmation emails an hour per person and 5 reset requests an hour per address.

### No domain of your own? Send through a mailbox (SMTP)

If you cannot add DNS records, use any mailbox instead. Set these in the server settings and redeploy: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, optionally `SMTP_PORT` (default 587; 465 is treated as secure) and `MAIL_FROM` (defaults to the mailbox itself; most providers refuse a different address). If Resend is also set, SMTP is used; add `MAIL_PROVIDER=resend` to prefer Resend.

**Gmail or Google Workspace (easiest):** 1. Use a Gmail account made for AdLens (for example `adlens.alerts@gmail.com`), not your personal one. 2. Open myaccount.google.com, Security, turn on **2-Step Verification**. 3. Search "App passwords" in the same page, create one named AdLens and copy the 16 letters. 4. Set `SMTP_HOST=smtp.gmail.com`, `SMTP_USER` to the full Gmail address, `SMTP_PASS` to the app password. 5. Redeploy and press **Settings, Preferences, Email delivery check, Send me a test email**.

Other providers: Brevo (`smtp-relay.brevo.com`, port 587, free 300 emails a day, verify a single sender address), Zoho Mail (`smtp.zoho.com`), Outlook (`smtp-mail.outlook.com`). Limits: a free Gmail account sends about 500 emails a day, Google Workspace about 2,000; emails show the mailbox as the sender; messages may land in spam more often than from a verified domain. Fine for confirmation emails, alerts and scheduled reports at small scale; a verified domain is better once you have many customers.

