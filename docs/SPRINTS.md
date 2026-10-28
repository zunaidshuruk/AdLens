# AdLens — Sprint Tracker

**AdLens · Marketing Intelligence Console**
A public, multi-user console. Anyone can sign up, connect their own Google Analytics 4, Search Console and Meta Ads accounts, and analyse their own sites with AI. (Convay is the first site it was built and tested on.)

- **Repo:** github.com/zunaidshuruk/AdLens
- **Live app:** https://adlens-1.ai.studio (AI Studio hosting). Vercel was tried and dropped on 19 Oct 2026.
- **Built with:** Google AI Studio (Build mode); planning and verification in Claude
- **Last updated:** 26 Oct 2026 (stage-6 added: Sprints 10, 11, 12, 15c, 17, 18, 19)

---

## Status at a glance

| # | Sprint | Status | Commit |
|---|--------|--------|--------|
| 0 | Prerequisites (Google Cloud, accounts) | ✅ Done (Google) · ⏳ Meta pending | — |
| 1 | App shell + mock data | ✅ Verified | `2f72c2a` |
| 2 | Web backend + Google sign-in | ✅ Verified | `05fd70c` |
| 3 | Live GA4 data | ✅ Verified, live | `9811014` |
| 4 | Live Search Console data + Vercel support | ✅ Verified (import fix `c72ab43`) | `dddd714` |
| 5 | Live Meta Ads data | ✅ Verified (code) · ⏳ live test needs Meta secrets | `7b30d64` |
| 6 | Traffic intelligence + AI referral traffic | ✅ Verified (code) | `c3a2d4d` |
| 7 | Accounts & data on **Firebase**: 7A auth · 7B Firestore projects · 7B-2 settings + images · 7C token vault + account deletion | ✅ Complete: 7A, 7B, 7B-2, 7C-1/2 and 7C-3 verified (`0bc704d`, 133 tests). One small fix pending (delete-account ownership check order) | `9b447e8`, `3c829da`, `0096f89`, `0bc704d` |
| 8 | **Design system, appearance & theming** (UI/UX overhaul) | ✅ Done: 8-1 to 8-4 on main (8-4 metric tooltips included) | — |
| 9 | Connections v2: Connect Facebook + project setup wizard | ✅ Code complete (9a–9d, Facebook card, disconnect fix) · ⏳ live test waits on Meta developer setup | — |
| 10 | Public-launch readiness + platform reviews | 🧩 Built, zipped in `stage-6-sprints-10-to-19` · owner tasks remain (domain, legal review, Google/Meta reviews; see `docs/LAUNCH-CHECKLIST.md`) | — |
| 11 | Search intelligence | 🧩 Built (reports + screens), zipped in `stage-6-sprints-10-to-19` | — |
| 12 | Page detail + site snapshot (cross-channel) | 🧩 Built, zipped in `stage-6-sprints-10-to-19`. Deviation: snapshot is a separate `/snapshot` page, Overview unchanged | — |
| 13 | Flexible report builders (Explore) | 🧩 Built, tested (371 tests), zipped as `stage-2-explore` · awaiting upload | — |
| 14 | **Custom dashboards: builder + template gallery** | 🧩 Built, tested, zipped as `stage-3-dashboards` · awaiting upload. Deviations: inline report specs, button move/resize (no drag-and-drop), 4 templates | — |
| 15 | **Hybrid AI analyst:** 15a cloud Gemini · 15b on-device "Private mode" · 15c optional WebLLM | 🧩 15a-3 (describe-a-widget) and 15b (Private mode) built, tested, zipped as `stage-5-ai-analyst-15` · awaiting upload · 15c (optional WebLLM, owner-hosted module) built, zipped in `stage-6-sprints-10-to-19` | — |
| 16 | Bring-your-own AI agents (16a server · 16b UI · 16c ask + chat · 16d webhook tools) | 🧩 16a–d built, tested, zipped as `stage-4-ai-agents` · awaiting upload | — |
| 16.5 | **Installable app (PWA)** | 🔄 PWA-1/2/3 on main · PWA-4 (phone polish) and PWA-5 code (sign-in proxy, `AUTH_PROXY` off by default) zipped as `stage-1-phone-polish-and-signin-proxy` · PWA-5 rollout needs a domain | — |
| 17 | MCP endpoint | 🧩 Phase A (access keys) and Phase B (OAuth 2.1) built, with `/mcp-access` screens; zipped in `stage-6-sprints-10-to-19` | — |
| 18 | Scale & hardening (shared cache, audit log, usage meter, error reporting, email summaries and alerts, code-splitting, load test) | 🧩 Built, zipped in `stage-6-sprints-10-to-19`. Billing parked; usage status is an API only (no page) | — |
| 20 | Billing and plan limits (manual invoicing; Free, Pro, Business) | 🧩 20a–20c built (server), zipped as `stage-7-billing-20abc` · 20d–20f (screens, legal) next | — |
| 19 | Enterprise: SAML/OIDC single sign-on, MFA, audit log | 🧩 Built, zipped in `stage-6-sprints-10-to-19` · needs the Firebase Identity Platform upgrade to work live | — |

**Long-lead track (runs alongside sprints, starts after Sprint 10):** Google OAuth verification, Meta Business Verification and Meta App Review. These take weeks and gate public sign-ups.

Legend: ⚠️ needs attention · ✅ done · 🔄 in progress · 🧩 prep work done in parallel · ⏳ waiting on setup · ⬜ not started

### Features adopted from Analytics MCP Server (planned 18 Oct 2026)

| Ref | Feature | Sprint |
|-----|---------|--------|
| #6 | Host breakdown (traffic, search and sitemaps per hostname) | 11 |
| #8–9 | AI referral traffic (by assistant, landing page, day; key events; share of sessions) | 6 |
| #10 | Source groups (AI assistants, Search, Social, Email, Referral, Paid, Direct/unknown) | 6 |
| #11 | Site snapshot (one-screen summary across sources, with rising/falling items) | 12 |
| #12 | Full traffic breakdowns (channel, source/medium, referrer, landing page, country, device, date + filters) | 6 |
| #14 | Page detail (one page: sources, AI share, countries, devices, trend, ranking queries) | 12 |
| #19 | Flexible GA4 report builder | 13 |
| #23 | SEO opportunities (positions 5–20 with below-typical CTR; cannibalisation) | 11 |
| #24 | Trending queries (rising, falling, new, lost; topic grouping) | 11 |
| #26 | Flexible Search Console report builder | 13 |
| #27 | Sitemaps (read-only list with errors and warnings) | 11 |
| #30 | MCP endpoint (external AI clients query AdLens) | 17 |
| #2 | Find sources by domain (auto-match GA4 property + Search Console site) | 9 (added for public sign-up) |
| #3 | Projects (multi-site) | 7 (required for public use) |

---

## How we work

1. **Planning (Claude):** design the sprint, write the AI Studio prompt.
2. **Building (AI Studio):** paste the prompt, build, publish, test, push to GitHub.
3. **Verification (Claude):** clone the repo, run `npm ci`, `tsc`, `npm run build` and `npm test`, smoke-test the server, and check the acceptance list. Then this file is updated and the next prompt is sent.
4. **Parallel work:** while AI Studio builds a sprint, Claude builds self-contained, tested files for the next one, delivered as a zip with the repo folder structure.
5. **Getting Claude's files in (from 19 Oct 2026):**
   1. Wait until AI Studio has **pushed** its current sprint, with nothing unpushed.
   2. Upload the files to GitHub.
   3. In AI Studio, **pull from GitHub before starting the next prompt**.
   - Never upload to GitHub while AI Studio has unpushed work.

---

## Prompt sizing rule (from 19 Oct 2026)

Long prompts make AI Studio run for 25+ minutes and tend to drop parts. From now on each prompt is one small deliverable:
- **One layer per prompt:** server OR screens, not both.
- **At most ~6 files touched** and **at most 5 acceptance checks**.
- **Target: about 10 minutes of build time.** If AI Studio runs past 20 minutes, stop it and use Checkpoint/Restore; the prompt was too big.
- AI Studio runs `tsc` and `npm test` **once, at the end**, and replies with at most 10 lines.
- Push to GitHub after every prompt; Claude verifies; pull before the next prompt.
- **Publish only when a whole sprint is done**; test in AI Studio's preview in between.
- Claude's tested files are uploaded to GitHub only while AI Studio has nothing unpushed.

## Architecture (fixed rules)

- React + TypeScript + Vite frontend; Express + TypeScript backend in `/server`.
- `src/config/app.ts` is the only place the app name is written. From Sprint 7 the tracked site is per-project data, never hard-coded.
- UI → hooks → adapter registry → adapters. Pages never import `/adapters/mock`.
- Each source has a mock and a live adapter. The registry switches per source based on connection state.
- All third-party API calls happen on the server. Tokens never reach the browser.
- Session: until Sprint 7, an AES-256-GCM encrypted httpOnly cookie `adlens_session`, with no database. **From Sprint 7:** user accounts in a database; Google/Meta tokens stored server-side with envelope encryption; the cookie holds only a session ID.
- **Multi-tenant isolation (from Sprint 7):** every query is scoped to the signed-in user's workspace, enforced in the database (row-level security), not just in code.
- **Least privilege:** read-only scopes only (`analytics.readonly`, `webmasters.readonly`, `ads_read`). No write actions to customers' accounts.
- **Report functions (from Sprint 6):** every report is a server-side function with a typed input schema, used by the API route now and by the AI analyst, custom agents and MCP endpoint later. Build each report once, never per consumer.
- **Server imports (Vercel):** every relative import in `server/`, `api/`, and the shared `src/types`, `src/utils`, `src/config` files ends in `.js` (folders as `/index.js`). Vercel runs the server as plain Node ES modules, which cannot resolve extensionless imports.
- Secrets (names only): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `APP_BASE_URL`.

---

## Sprint 0 — Prerequisites

**Google: ✅ done**
- Google Cloud project with Analytics Data API, Analytics Admin API and Search Console API enabled.
- OAuth consent screen: External, Testing mode, with zunaid@synesisit.com.bd added as a test user.
- OAuth client "AdLens Web" (Web application), with redirect URI `https://adlens-1.ai.studio/api/auth/google/callback`.
- GA4 access confirmed (live data showing).

**Meta: ⏳ pending (needed for Sprint 5)**
- A Meta developer app (Business type) connected to the Synesis IT business portfolio.
- A System User with View performance access on the Convay ad account, and a never-expiring token with `ads_read`.
- Secrets: `META_ACCESS_TOKEN`, `META_APP_SECRET`, `META_AD_ACCOUNT_ID` (digits only), added in AI Studio and Vercel.

---

## Sprint 1 — App shell + mock data ✅

**Commit:** `2f72c2a` · **Verified:** 18 Oct 2026

Delivered:
- Full-stack skeleton with Express `/api/health`.
- Seven pages: Overview, Google Analytics, Search Console, Meta Ads, AI Analyst (placeholder), Connections, Settings.
- Adapter interfaces and registry, plus seeded mock data for Convay.
- Timezone-aware date presets, with comparison periods for every preset including Custom.
- Sortable, searchable tables with CSV export; dark mode; mobile drawer.

Verification notes:
- Fixed in Sprint 2: an esbuild/Vite 8 peer conflict broke `npm install`.
- Housekeeping done in Sprint 2: package name, committed build output, `.aistudio` folder.

> History: the first attempt (repo `Marketing-analyst`) was generated as an Android app and was restarted as a web app in this repo.

---

## Sprint 2 — Web backend + Google sign-in ✅

**Commit:** `05fd70c` · **Verified:** 18 Oct 2026

Delivered:
- Google OAuth (read-only scopes), with a CSRF state cookie and automatic token refresh.
- Encrypted session cookie and disconnect with token revoke.
- Connections page with GA4 property and Search Console site pickers.
- Health check that reports missing secrets by name.
- Rate limit of 60 requests per minute on `/api/google/*`.

Verification notes:
- Tests pass, including encryption round-trip and tamper rejection.
- Forged callback rejected.
- Real sign-in confirmed after fixing the redirect URI and adding the test user.

---

## Sprint 3 — Live GA4 data ✅

**Commit:** `9811014` · **Verified:** 18 Oct 2026 (live data confirmed in app)

Delivered:
- `/api/ga4/*` routes: overview, traffic over time, acquisition, campaigns, top pages, conversions (key events), property info.
- Two-date-range comparison in one request, with a 10-minute cache (`X-AdLens-Cache` header).
- Live GA4 adapter; the registry switches mock to live when connected and a property is selected.
- Live/Mock badges, property time zone note, and a data freshness note.
- `/api/_dev_reload` limited to non-production; placeholder email removed.

Verification notes:
- Build clean; 8 tests pass.
- Open: cross-check AdLens vs GA4 UI for Last 28 days (sessions and users should match closely).

---

## Sprint 4 — Live Search Console data ✅

**Prompt sent:** 18 Oct 2026

**Commit:** `dddd714` · **Verified:** 18 Oct 2026

- The push problem resolved itself: AI Studio pushed on top of the uploaded files, with no conflict.
- Clean `npm ci`, tsc, build; 33/33 tests pass, including the new Search Console mapper and route tests.
- All 7 bundle files are byte-for-byte identical to the originals; `docs/SPRINTS.md` added.
- The tab title is fixed, and `server/app.ts`, `api/index.ts` and `vercel.json` were added.
- **Blocker found (fixed in `c72ab43`):** Vercel's own build compiled, but the function crashed on start (`ERR_MODULE_NOT_FOUND`), because server imports have no file extensions. That's why `/api/health` returned 404.
  - The fix was tested locally: `.js` import extensions in 15 files. After it, tsc is clean, 33/33 tests pass, the Vercel function serves `/api/health`, and the build passes.
  - Fix landed in `c72ab43`: 34/34 tests pass, including a guard test that fails on extensionless imports.
- Rule going forward: every file enters the repo through AI Studio only.

Scope:
- `/api/search-console/*` routes: overview (no dimensions, so totals include anonymised queries), performance over time, queries, pages, countries, devices, site info.
- Comparison via two parallel requests; impression-weighted average position.
- Country codes mapped to names; both `sc-domain:` and `https://` site formats supported.
- Generalised registry for setting each source live or mock.
- Freshness note (2–3 day lag) and a note about hidden low-volume queries.
- Tab title becomes "AdLens — Marketing Intelligence Console".

Acceptance to verify:
- [ ] Search Console page shows Live data; GA4 is still Live
- [ ] % changes correct with comparison on
- [ ] Countries show names
- [ ] Tab title fixed
- [ ] npm ci / tsc / build / tests pass, including the new mapper tests

---

## Sprint 5 — Live Meta Ads data ✅

**Commit:** `7b30d64` · **Verified:** 18 Oct 2026 (code; live data pending Meta secrets)

- Clean install, tsc and build; 35/35 tests pass.
- Mapper changes are only the requested renames, unions moved to `src/types` and casts removed; test logic unchanged.
- `server/lib/meta.ts`: Graph API v26.0, `appsecret_proof`, paging capped at 5,000 rows, friendly error codes, token never returned.
- Routes: unified attribution, current + previous periods in parallel, 10-minute cache.
- Smoke-tested through Vercel's compiled function:
  - without Meta secrets → 503 `META_NOT_CONFIGURED`, Google unaffected;
  - with dummy secrets → friendly 502, no token leaked;
  - a bad date → 400.
- Meta money is shown in the ad account currency (not converted).
- Minor follow-up (Sprint 6): only follow `paging.next` URLs on graph.facebook.com.

**Open issue:** bare `API request failed: 403` on the dashboard. It isn't an AdLens error (those carry messages), so likely Vercel Deployment Protection or AI Studio's preview frame. Waiting on browser network details.

**Parallel prep done (18 Oct 2026):**
- `server/lib/metaAdsMapper.ts` and `server/lib/metaAdsMapper.test.ts` built and tested against the repo (19/19 tests pass, tsc clean).
- Added to GitHub directly in commits `bb0ff7a` and `618eadf` (this caused the push conflict). Re-added through AI Studio in the Sprint 5 prompt if the AI Studio push overwrites them.
- The mapper covers lead counting without double-counting (total vs Instant Form + Pixel), link-click based CTR/CPC, recomputed ratios, non-additive reach, zero-filled days, label mapping (objective, status, format, audience) and error code mapping.

**Prompt sent:** 18 Oct 2026 (run only after Sprint 4 is on GitHub).

Scope:
- Meta access via a **System User token** (read-only `ads_read`, never expires), with no Meta sign-in flow. Secrets: `META_ACCESS_TOKEN`, `META_APP_SECRET`, `META_AD_ACCOUNT_ID`. Graph API pinned to **v26.0**, and `appsecret_proof` on every call.
- `/api/meta/*` routes for account info, overview, spend over time, campaigns, ad sets and ads, using the mapper. 10-minute cache; Ads Manager attribution setting.
- Type changes:
  - Widen objective, status and format unions to match the mapper.
  - Rename the `…Usd` money fields to currency-neutral names, with an account currency field (the ad account may bill in BDT).
- Live Meta adapter and registry switch.

---

## Sprint 6 — Traffic intelligence + AI referral traffic ✅

**Commit:** `c3a2d4d` · **Verified:** 18 Oct 2026 (code; live AI Traffic page to be checked)

- Clean install, tsc and build; 39/39 tests pass. Existing tests unchanged; `sourceGroups.ts` untouched.
- Report registry with 10 GA4 report functions; `/api/reports` lists them with JSON Schema inputs (zod v4).
- New routes: traffic breakdown, source groups, AI traffic. The AI filter is built from the assistant list (739-character regex).
- Smoke-tested through Vercel's compiled function. Proper JSON errors without a session or property.
- Meta paging now only follows graph.facebook.com.
- To check live: the AI Traffic page with a real GA4 property. If Google rejects the long regex, split it into an OR of shorter filters.


Adopts #8–10 and #12.
- **Report-function layer:** refactor existing GA4/Search Console/Meta routes into typed report functions (see Architecture). This is the foundation for Sprints 14–17 (dashboard widgets, AI analyst, agents, MCP).
- **Full traffic breakdowns:** by channel, source/medium, exact referring domain, landing page, country, device or date, with country, device and browser filters and period comparison.
- **Source groups:** AI assistants, Search, Social, Email, Referral, Paid, and Direct/unknown, with the classification rules documented in the app.
- **AI referral traffic:** a new "AI Traffic" page.
  - Sessions from ChatGPT, Perplexity, Gemini, Claude, Copilot, DeepSeek, Meta AI and others, matched from GA4 session source against a versioned AI-domain list.
  - Views by assistant, by landing page and by day, with key events, share of total sessions, and comparison.
  - A clear note that untagged AI visits show as Direct.
- **Prep done (18 Oct 2026):** `server/lib/sourceGroups.ts` + `sourceGroups.test.ts`.
  - AI assistant list (15 assistants, version 2026-10-18).
  - 8-group classifier with documented rule order.
  - Source-group totals and AI referral summary (by assistant, landing page, day).
  - 5 tests.

## Sprint 7 — Accounts & data on Firebase ⬜

**Re-planned 18 Oct 2026:** Firebase replaces Supabase. Firebase Authentication handles accounts and SSO, Cloud Firestore holds app data, and Cloud Storage for Firebase holds uploads. Firebase is added to the **existing AdLens Google Cloud project**, so the OAuth consent screen, Google client and billing stay in one place. Hosting stays on Vercel. The Supabase prompt (7A) is withdrawn; its SQL schema and tests are kept only as a reference for the security model.

### 7A — Authentication

- **Sign up:** email + password (password-strength rules), name, and terms acceptance. A **verification email** is sent, and data features unlock after verification.
- **Sign in:** email + password, and **SSO buttons: Google and Microsoft**. Apple and GitHub are optional later. Facebook sign-in is optional and separate from connecting Facebook Ads.
- **Forgot password:** enter email, then a reset link is emailed. The response is always the same, so attackers can't tell whether an email is registered.
- **Reset password:** a branded `/auth/action` page handles the email link (reset password, verify email, recover email), instead of Firebase's default page.
- **Change password** when signed in, which requires re-entering the current password (Firebase re-authentication).
- **Account linking:** one account per email. If someone signs up with email and later uses Google with the same email, they're guided to link the two instead of creating a duplicate.
- **Server:** the Firebase Admin SDK verifies the ID token on every API call (`Authorization: Bearer`). The service account is stored as a Vercel secret.
- **Abuse protection:** email enumeration protection on, a password policy, and sign-in attempt limits (Firebase built-in plus the server rate limit). App Check (reCAPTCHA) moves to Sprint 10.
- **Security fixes pulled forward:** the Meta system-user token is restricted to allow-listed emails, and the Google cookie connection is bound to the signed-in user (cleared on sign-out). Without these, any visitor to the public URL could see Convay's Meta data, or a shared browser could inherit someone else's Google connection.
- **Emails:** sender name "AdLens", templates customised; the custom sender domain comes in Sprint 10.

### 7B — Firestore data + projects

- **Data model:**
  - `users/{uid}`
  - `workspaces/{wsId}` with `{ name, ownerId, plan: "beta", members: { uid: role } }`
  - `workspaces/{wsId}/projects/{projectId}`
  - `workspaces/{wsId}/usage/{yyyy-mm}`
- **Firestore Security Rules:**
  - users only read and write their own workspaces and projects;
  - plan, owner and members are changeable only by the server;
  - projects are created only via the server, so plan limits hold;
  - members can't delete projects;
  - rules are tested with the Firebase Emulator (same cases as the Supabase RLS tests).
- **First sign-in:** the server creates the user doc, a personal workspace and owner membership (idempotent; no Cloud Functions needed).
- **Projects API, switcher and onboarding:** plan limits from config; the active project is sent as `X-AdLens-Project`.
- **Demo mode** ("Demo Store") and **removal of all hard-coded Convay references**.
- **Uploads (Cloud Storage for Firebase):** images only.
  - **Profile pictures** at `users/{uid}/avatar.{ext}`: only the owner writes; signed-in users can read.
  - **Workspace logos** at `workspaces/{wsId}/logo.{ext}`: owner/admin write; members read.
  - Rules allow JPEG/PNG/WebP up to 2 MB. Images are resized in the browser (avatars 256 px, logos 512 px) before upload, and replacing a file deletes the old one.
- **Settings & configuration, synced across devices in Firestore** (replacing localStorage):
  - *User settings* `users/{uid}`: name, avatar, theme, default date range, default comparison on/off, display currency/time zone defaults, number format, email notification preferences.
  - *Workspace settings* `workspaces/{wsId}`: name, logo, default currency and time zone for new projects, members (read-only until invites).
  - *Project configuration* `.../projects/{id}`: name, domain, GA4 property, Search Console site, Meta ad account, time zone, currency, brand terms (used to exclude brand queries in Sprint 11), hostname filters.
  - Validation in Security Rules plus server-side zod; defaults applied when fields are missing.

**7A verified (19 Oct 2026):** `9b447e8` + fixes `ea9755a` (Firebase 13, a single @firebase/app copy).
- 56/56 tests pass.
- Google sign-in works live on AI Studio.
- Signed-out and forged-token requests are refused (401).
- Meta allowlist in place; the private key never reaches the browser.
- Microsoft hidden via `AUTH_PROVIDERS=password,google`.
- Verification emails not arriving: open (see backlog).

**7B verified (19 Oct 2026):** `3c829da` + `2758baf`.
- 58/58 tests pass, tsc clean, rule files untouched.
- Bootstrap in a Firestore transaction; workspaces/projects API with membership checks; plan limit; project switcher, onboarding and demo mode.
- Convay removed from the app code (Claude renamed the remaining examples in its prep files and tests to "Acme").
- Small fixes carried into 7B-2:
  - check the plan limit inside a transaction (two quick clicks could exceed the limit);
  - don't accept `isDemo` from the browser;
  - use the `members` map as the single source of truth;
  - engines `>=22.12` instead of `>=20`;
  - remove the stray `firebase/firebase-rules.yml`.

**7B prep done (19 Oct 2026):**
- `firebase/firestore.rules`: users, workspaces, projects, usage, token vault, deny-by-default.
- `firebase/storage.rules`: avatars and logos (JPEG/PNG/WebP up to 2 MB; membership from Firestore).
- 27 emulator test cases (72 allow/deny assertions) in `firebase/rules-checks/` (firestoreRules + storageRules), `firebase.json`, and CI workflow `.github/workflows/firebase-rules.yml`.
- What the checks cover:
  - isolation between users;
  - verified-email gate, with Microsoft sign-in treated as verified;
  - settings validation;
  - plan, owner and members locked to the server;
  - server-only project writes;
  - token vault invisible to everyone;
  - image type, size and name limits;
  - owner/admin-only logos.
- Type-checked locally. The checks run against the real Firebase emulator in GitHub Actions on every push (the emulator can't be downloaded in Claude's sandbox), and `npm run test:rules` runs them.

### 7C — Token vault + account lifecycle (3 small prompts)

**Design (19 Oct 2026):**
- Google (and later Meta) tokens move from the browser cookie into a **server-only Firestore collection `connections`**, one document per user per provider (`{uid}_{provider}`). The published rules deny all browser access; only the server (Admin SDK) reads and writes.
- **Encryption:** AES-256-GCM, key derived with HKDF from `TOKEN_ENCRYPTION_KEY`. Every ciphertext is **bound to its owner** (user id + provider + connection id), so a copied document can't be decrypted by someone else.
- **Key rotation:** keep the old secret in the optional `TOKEN_ENCRYPTION_KEY_PREVIOUS` (comma-separated); tokens are re-sealed with the new key the next time they refresh.
- **Whose connection is used:** each person's data requests use **their own** Google/Meta connection. A teammate who hasn't connected sees "Connect Google to view this project". Shared project connections can be added later if needed.
- Refreshes are coalesced (one refresh per connection even under many requests); a revoked token marks the connection "needs reconnect" and stops retrying; temporary errors keep it active.
- Prep done and tested (19 Oct 2026): `server/lib/tokenVault.ts` + `tokenVault.test.ts` (15 tests; mutation-checked: removing the owner binding or the single-flight makes tests fail).

**Prompts:**
- **7C-1:** vault wiring: Firestore store adapter, Google refresher, OAuth callback saves into the vault (cookie kept for now), Connections reports vault status.
- **7C-2:** switch all data routes to the vault; lazy migration of existing cookie connections; disconnect revokes at Google and deletes the vault document; tokens leave the cookie entirely.
- **7C-3:** delete account: revoke tokens, delete Firestore data (users, workspaces owned, projects, usage, assets, connections), delete the Firebase Auth user; re-authentication required.

**Firebase plan:** the free Spark plan covers 7A–7C at beta scale. Blaze (pay-as-you-go) is needed later for Identity Platform features (SAML/OIDC, MFA) and higher limits. Firestore location: **asia-southeast1 (Singapore)**. This can't be changed later.

## Sprint 8 — Design system, appearance & theming ⬜

Goal: a cleaner, more modern UI that every user can personalise. It comes before the remaining feature sprints so all new screens are built on it.

**Research summary (19 Oct 2026):** Databox, AgencyAnalytics, Whatagraph, Triple Whale and Looker Studio.
- Templates first, then drag-and-drop editing (Databox: 200+ templates; AgencyAnalytics: start blank, from a template, or by cloning).
- Grid-based canvas (Whatagraph's grid is easier than AgencyAnalytics' free-form canvas).
- Saved style themes reusable in one click (AgencyAnalytics).
- Pinned metrics for "what matters most" at the top (Triple Whale).
- Presentation/TV mode.
- AI-generated widgets from plain language (Triple Whale Moby). AdLens covers this in Sprint 15.

**Design system:**
- One set of **design tokens** (CSS variables) for every colour, radius, spacing, shadow and font size. Every component uses tokens, never hard-coded values.
- Shared component library (buttons, cards, KPI tiles, tables, charts, dialogs, empty/loading/error states) on Tailwind + shadcn/ui patterns.
- **Accessibility:** WCAG 2.2 AA contrast, visible keyboard focus, screen-reader labels on charts, reduced-motion support.

**Navigation and layout refresh:**
- Collapsible left sidebar with the project switcher; sticky top bar with date range and comparison.
- **Command palette (Ctrl/⌘ K)** to jump to pages, projects, settings and metrics.
- Metric definitions in an info tooltip on every KPI.
- Consistent page headers; breadcrumbs for drill-downs; mobile bottom navigation.

**Appearance settings (Settings → Appearance), per user, synced via Firestore:**
- **Theme presets:** AdLens Light, AdLens Dark, Midnight, Ocean, Forest, Sunset, High contrast, plus "match system".
- **Custom theme:** pick an accent colour, and AdLens generates the full palette (shades, hover states, dark-mode variants) automatically, with a live preview. Optional: background tint, card style, corner roundness.
- **Contrast guard:** warns, and offers a one-click fix, if text colours fall below WCAG AA.
- **Font size:** Small / Default / Large / Extra large (scales the whole UI); font choice from a short curated list.
- **Density:** Comfortable / Compact.
- **Chart palette:** Default, Colour-blind safe (Okabe–Ito), Monochrome accent, Brand.
- Save custom themes; reset to default.

**Workspace brand theme (owners/admins):** logo + brand colour applied to shared and exported dashboards and reports (full white-label later). Users' personal theme still applies inside the app unless they choose "use workspace theme".

**Finding (19 Oct 2026):** the app has about **607 hard-coded colour classes** (`bg-white`, `text-slate-900`, `blue-600`, `dark:` pairs). A theme can only restyle what uses named colour roles, so the migration to roles is the real work of this sprint.

**Colour roles** (Tailwind utilities generated from `--color-*` variables; defaults come from `tailwindThemeCss()` in `themeEngine.ts`, the user's theme overrides them on `<html>`):
- Surfaces: `bg-page`, `bg-surface`, `bg-raised`, `bg-fill-1/2/3` (panels, chips, hover), `border-line`, `border-line-strong` (inputs, meets 3:1), `bg-scrim` (overlays).
- Text: `text-fg`, `text-fg-muted`, `text-fg-subtle` (icons and placeholders, 3:1), `text-on-scrim`.
- Accent: `bg-accent`, `hover:bg-accent-hover`, `bg-accent-soft`, `border-accent-line`, `text-accent-text`, `text-on-accent`, `ring-focus`, `bg-accent-50 … 950`.
- Status (each with `-soft` panel, `-line` border, text colour, and `text-on-*` for solid buttons): `success`, `warning`, `danger`.
- Charts read `--chart-1 … --chart-8`. Every text role is checked against every surface it can sit on.

**Finding, corrected:** the app has **2,344 colour class uses in 29 files** (607 was a line count). The default presets use a cool tint so the migrated app keeps today's slate look.

**Four small prompts:**
- **8-1** theme provider (applies variables, font size, density, radius; remembers the last theme to avoid a flash), the Tailwind `@theme` block, Settings → Appearance (presets, accent picker with contrast guard, font size, density, chart palette). No page restyling yet.
- **8-2** run the colour migration script, fix the 2 items it lists, add `check:colors`.
- **8-3** app shell and charts: sidebar, header, mobile navigation, command palette (Ctrl/⌘ K); chart colours (about 40 hex codes in 7 files) move to `--chart-N` and `--color-fg-muted` / `--color-line`.
- **8-4** metric tooltips from the glossary; `check:colors` added to the tests so hard-coded palette colours cannot return.

**Colour migration (prepared and proven, 19 Oct 2026):**
- `scripts/migrate-colors.ts` (dry run by default; `--write`; `--check`), engine `scripts/colorMigration.ts`, `scripts/color-shift-report.ts`. Exact string scanner (comments, JSX text and code are never touched); light and `dark:` partners collapse into one role; anything unclear is left as written and reported.
- Dry run on the real app: **2,341 of 2,344 classes converted automatically (1,071 light/dark pairs collapsed); 2 items need a human** (white spinners on a dark overlay → `text-on-scrim`).
- Proven on a scratch copy: second run changes nothing; `tsc` clean; build passes; 195 tests pass; all 60 distinct role classes in use exist in the generated Tailwind CSS.
- Look preserved: usage-weighted mean colour shift 0.077 (53% of usages under 0.06). The biggest changes are deliberate: secondary text merges into the main text colour (slightly crisper), input borders get stronger to meet accessibility contrast, and faint icon text is slightly darker.
- 11 tests, mutation-checked (scanner, pair collapsing, rule table, rule/theme sync) plus a real-file test that migration is idempotent and changes only the inside of strings.

**Other prep done (19 Oct 2026), tested and mutation-checked:**
- `src/utils/themeEngine.ts` (+ test, 17 tests):
  - one accent in, a complete theme out: OKLCH shade scale, light and dark tokens, tints, radius, density and font-scale tokens, as CSS variables;
  - every text colour is derived and checked against WCAG (AA, AAA in High contrast). A property test over about 1,000 generated themes, including yellow, white, black and grey accents, finds no unreadable text;
  - contrast guard with a "fix it for me" suggestion for accents used as text or links;
  - seven presets, "match system", chart palettes (default, canonical colour-blind safe Okabe–Ito, monochrome, brand), and `sanitizeAppearance` to validate saved settings.
- `src/utils/commandPalette.ts` (+ test, 9 tests): Ctrl/⌘+K ranking (exact, prefix, word, keyword, initials such as "gsc", letters-in-order), recent-command boost, bold-highlight ranges, arrow-key wrap.
- `src/config/metricGlossary.ts` (+ test, 6 tests): plain-language definition, formula and "which direction is good" for 28 metrics, with source-aware lookup ("Clicks" means different things in Search Console and Meta).

**Rules for saving appearance (prepared 19 Oct 2026, written but NOT run locally because the Firebase emulator can't run in Claude's environment):** `firebase/firestore.rules` now accepts and validates `settings.appearance` (preset, custom theme with a lower-case #rrggbb accent, radius, density, font scale, chart palette), with one new rules test (15 allow/deny checks). GitHub Actions runs it on upload; after a green run, republish the rules in the Firebase console. The server's settings validation (`server/routes/workspaces.ts`) and the client settings types are updated by AI Studio in 8-1.

## Sprint 9 — Connections v2 ⬜

- **Connect Google per user**, with incremental scopes: Analytics and Search Console are requested only when connecting, not at sign-in.
- **Connect Facebook** via Facebook Login for Business: approve read-only `ads_read`, then pick ad account(s) from `me/adaccounts`. The ~60-day long-lived token is stored in the vault, with expiry shown and a reconnect reminder 7 days before.
- **Project setup wizard (#2):** enter a domain, and AdLens ranks matching GA4 properties and Search Console sites, explains each match, and pre-selects the best pair. Then pick the Meta ad account.
- **Setup assistant + Test connection,** with plain-English diagnosis (expired token, no ad accounts, missing permission, account not in reviewed scope).
- The system-user token is removed (or kept as an admin-only, single-tenant debug option behind a flag).

**Prep done (19 Oct 2026):**
- `server/lib/sourceMatcher.ts` + test: domain → ranked GA4 properties (by web data stream, then name) and Search Console sites (domain property > https prefix > subdomain; permission-aware). Plain-English reasons, best-pair suggestion and notes.
- `server/lib/metaOAuth.ts` + test: Facebook Login for Business URL (config_id), code and long-lived exchanges, token parsing.
  - Effective expiry is the earlier of token expiry and Meta's data-access expiry.
  - Reconnect status (ok / due soon at 7 days / expired).
  - Ad-account mapping with status labels.
  - Plain-English diagnosis: cancelled, not in app roles, password changed, rate limited, permission, missing ads_read, expired, no ad accounts.

## Sprint 10 — Public-launch readiness ⬜

Everything Google and Meta check before allowing public sign-ups:
- **Own domain** (open decision), with homepage, Privacy Policy and Terms pages, verified in Search Console. Google's brand verification needs a domain you own, and `*.vercel.app` won't do.
- **Privacy Policy** covering:
  - what data is read (read-only), and how it's stored and encrypted;
  - retention and deletion;
  - **AI processing disclosure** (data sent to Gemini or to user-chosen AI agents only when the user asks);
  - the Google API Services User Data Policy / Limited Use statement;
  - Meta Platform Terms compliance.
- **Meta data deletion callback** endpoint, plus deletion instructions page (required by Meta).
- **Consent and cookie notice** for EU/UK visitors (essential cookies only unless the user agrees).
- **Landing page:** what AdLens does, screenshots, sign-up button.
- **Submissions:**
  - Google OAuth app verification: sensitive scopes, which needs a demo video and scope justifications.
  - Meta Business Verification of Synesis IT.
  - Meta App Review for `ads_read` Advanced Access, which needs a screencast and test credentials.
- Until approval: Google allows up to 100 test users (Testing mode), and Meta allows app-role users only. Use this for a private beta.

## Sprint 11 — Search intelligence ⬜

Adopts #6, #23, #24 and #27. Prep is done in `server/lib/searchInsights.ts` and `server/lib/hostBreakdown.ts`.
- Convert Search Console and Meta routes into report functions.
- Trending queries (rising, falling, new, lost; topics), SEO opportunities and cannibalisation (rules shown in the UI), sitemaps (read-only), host breakdown with flags.
- Topic grouping ignores the project's brand name automatically.

## Sprint 12 — Page detail + site snapshot ⬜

Adopts #11 and #14.
- Page detail drill-down from anywhere.
- Pages table joining GA4 and Search Console.
- Site snapshot as the new Overview.
- Cross-channel: Meta spend matched to GA4 sessions via UTM, and campaigns with no UTM traffic flagged.

**Prep done (19 Oct 2026):** `server/lib/campaignMatcher.ts` + test.
- Match order: Meta campaign ID inside utm_campaign → normalised name → close word overlap (flagged).
- Counts only Meta-tagged GA4 traffic.
- Outputs cost per session / engaged session / key event, and landing rate (sessions ÷ link clicks).
- Flags: no tracked traffic, low landing rate, source not Meta, likely match only.
- Also lists Meta-tagged GA4 campaigns with no Meta match (renamed or typo'd UTMs), plus totals including spend without tracking.

## Sprint 13 — Flexible report builders ("Explore") 🧩 built, awaiting upload

Adopts #19 and #26.
- GA4 and Search Console builders with saved reports (stored per project) and CSV export.

## Sprint 14 — Custom dashboards: builder + template gallery ⬜

Goal: every user can choose a ready-made dashboard or build their own, per project.

**Template gallery:**
- Executive overview (the Sprint 12 snapshot)
- Paid social (Meta)
- Meta vs website results (campaign matcher)
- SEO health
- Content performance
- AI traffic
- Lead generation funnel
- Weekly client report

Each template has a preview, its required sources, and a "Use template" button. Widgets needing an unconnected source show a "Connect…" placeholder instead of breaking.

**Three ways to start:** template, blank, or duplicate an existing dashboard.

**Builder (edit mode):**
- 12-column **snap-to-grid** canvas; drag to move, drag corners to resize.
- Widget library on the right, grouped by source, with search.
- Undo/redo; autosave with "Saved" status; leave without saving = revert.

**Widget types:** KPI tile (with sparkline and comparison), line, area, bar, stacked bar, donut, table, funnel, geo (country) map, text/note, section heading, divider.

**Widget settings:**
- metric(s), dimension, filters;
- date range override;
- comparison on/off, goal/target line;
- colour (from the theme palette);
- title and description.

**Data:** every widget is a call to a **report function** (Sprint 6 registry), so widgets automatically include everything built in Sprints 6–13. Explore (Sprint 13) gets a "Save as widget" button.

**Pin to dashboard:** a 📌 on any KPI or chart anywhere in AdLens adds it to a chosen dashboard.

**Viewing:**
- Dashboard tabs per project; set a default dashboard.
- **Presentation / TV mode** (full screen, auto-refresh, cycles through dashboards).
- Mobile: widgets stack in reading order.

**Save as template:** own templates, reusable across the workspace's projects.

**Storage:** `workspaces/{ws}/projects/{p}/dashboards/{id}` (layout + widget configs, validated by zod on the server; members read, editors write via the server API); workspace templates under `workspaces/{ws}/dashboardTemplates/{id}`.

**Plan limits:** dashboards per project and widgets per dashboard from the plan config.

**Performance:** widgets load independently, with a skeleton each, and share cached report results; batch requests per dashboard.

Parallel prep candidates:
- dashboard schema (zod) + layout validation, collision/compaction and mobile reflow;
- template definitions as JSON;
- template → dashboard instantiation with source checks;
- tests.

## Sprint 15 — Hybrid AI analyst: cloud Gemini + on-device Private mode ⬜

**Decision (19 Oct 2026):** hybrid. **Cloud Gemini is the default; the on-device model is an opt-in "Private mode".**

**How it works (both engines):** AdLens report functions fetch and calculate the exact numbers on the server. The model only chooses which report to run and explains the result in words. This is why a small on-device model can work: it never needs to hold all the data, only one compact table at a time.
- **Dates are never chosen by the model.** The date range (and comparison) selected in the app are injected into every tool call.
- **Settings → AI engine (per user, synced in Firestore):**
  - *Cloud* (default) or *On-device (Private mode)*.
  - *Allow cloud fallback*: off by default.
  - *Download on-device model* button, with the size explained before downloading.
- **Privacy rule (tested):** in Private mode a question is never sent to the cloud unless the user turned on "Allow cloud fallback" or presses **"Ask the cloud model"** for that one question. Every answer shows a badge: "Answered on your device" or "Answered by Gemini".
- **Cloud engine is the fallback in Cloud mode:** when the cloud is unavailable (offline, plan limit reached, not configured) and the on-device model is already downloaded, AdLens uses it, since that is more private, never less.
- Each answer has a "Numbers used" panel showing the report results the model saw.

### 15a — Tools, chat screen and cloud Gemini (works for everyone)
Split into small prompts: **15a-1** server endpoint `POST /api/ai/ask` wiring `analystService` (report registry as tools, atomic monthly allowance in Firestore, Gemini key and model from the environment, rate limit); **15a-2** chat screen with "Numbers used" and engine badge; **15a-3** consent dialog, usage meter and "describe a widget".
- Gemini function calling over the report functions (declarations built by `src/utils/aiTools.ts`), snapshot-first strategy, streaming answers.
- Chat UI on the AI Analyst page; conversation context includes the selected range and the current page.
- **"Describe a widget":** generate a dashboard widget from plain language, preview it, add it to a dashboard (Sprint 14 builder).
- Per-user AI limits read from the workspace plan. First-use consent: "Your analytics data will be sent to Google Gemini to answer your questions."
- Gemini API key stays on the server (AI Studio secret `GEMINI_API_KEY`).

### 15b — On-device engine via Chrome's built-in AI (Gemini Nano)
- Detect availability (`unsupported | downloadable | downloading | available`); download only after explicit consent (the model is several GB).
- Session with structured JSON output; tool shortlist (3–4 tools) and compacted results (≈1,500 tokens each) so every request fits the small window (~9k tokens measured in one setup).
- Answers a question in up to 3 tool calls; if the model can't decide, it says so and offers "Ask the cloud model".
- Requirements shown up front: desktop Chrome 148+, ≥22 GB free disk, GPU with >4 GB VRAM (or 16 GB RAM / 4 cores). English, Spanish and Japanese only; Bangla and other scripts are routed to "Ask the cloud model".
- Safari and Firefox have no built-in model, so those users see "Private mode isn't available in this browser".

### 15c — Optional WebLLM engine (only if users ask)
- Open models (e.g. Qwen, Llama, Gemma) through WebGPU for browsers without Chrome's built-in AI. Structured JSON output instead of native function calling (WebLLM marks function calling as work in progress). Larger downloads and slower loads; consider only after 15b has real usage.

**Prep done (19 Oct 2026), tested and mutation-checked:**
- `server/lib/analystService.ts` (+ test, 10): the single entry point for "ask a question". Validates input first; refuses with a clear message when no data source is connected; requires a recorded consent for custom agents; offers only reports whose source is allowed AND connected; takes one question from the monthly allowance before calling the provider (built-in analyst only) and hands it back if the provider fails; never returns secrets.
- `src/utils/aiEngineRouter.ts` (+ test): engine choice, script/language detection, and the privacy rule checked across every combination of settings and environment (the exhaustive test fails if the rule is weakened).
- `src/utils/aiReportCompactor.ts` (+ test): shrinks any report result to a token budget: one-line KPIs, small tables, daily series summarised as min/max/average plus a sample, and an honest "showing first N of M rows".
- `src/utils/aiTools.ts` (+ test): report definitions → Gemini function declarations (`parametersJsonSchema`), date-argument injection, tool shortlisting by question, and a compact tool menu for small models.

## Sprint 16 — Bring-your-own AI agents 🧩

A user can add their own AI agent that answers questions about their ads and traffic, using the same report tools as the built-in analyst (Sprint 15). Three kinds:
- **Gemini** with the user's own API key.
- **OpenAI-compatible** (any server that speaks the chat-completions format: OpenAI, OpenRouter, a company gateway, Ollama or vLLM behind HTTPS), with base URL, model and optional key.
- **Webhook**: the user's own service. AdLens sends a signed JSON request (protocol v1) and the service replies with an answer or with report calls. AdLens shows a generated signing secret once.

**Safety design (built and tested):**
- **Own keys are encrypted** with the vault, bound to the user and the agent; the browser only ever sees "••••abcd". Keys travel in a header only, never in URLs, logs or error messages.
- **SSRF protection:** https only, no credentials, no IP addresses or internal-looking names, ports 443/8443, address checked at connect time (DNS rebinding, mixed answers), no redirects, size and time limits. Guards against a user pointing an agent at cloud metadata or an internal network.
- **Permissions:** each agent gets only the reports whose data source the agent is allowed AND the project has connected, optionally a hand-picked list. A tool outside the list is never run, even if the model asks.
- **Dates come from the app,** never the model. Report text is wrapped as data that cannot close its tag, and the system rules come before the owner's custom instructions.
- **Hard limits:** tool calls, steps, total time, answer length; never throws. Chat history from the browser is sanitised (forged tool results are dropped).
- **Consent:** before an agent is first used, the user confirms that their analytics numbers will be sent to that provider.

**Prep done (19 Oct 2026), 183 tests in the repo, each safety property mutation-checked:**
- `server/lib/ssrfGuard.ts` (+ test, 12): IP classification (IPv4, IPv6, mapped, NAT64, 6to4), URL rules, connect-time guarded lookup, guarded request. Found and fixed an unhandled-error bug before it reached production.
- `server/lib/agentProviders.ts` (+ test, 12): request builders and parsers for Gemini (including Gemini 3 thought signatures), OpenAI-compatible (tool-name mapping because OpenAI forbids dots), webhooks (HMAC-signed, replay window); secret redaction; friendly error mapping.
- `server/lib/agentRunner.ts` (+ test, 14): the tool loop with permissions, budgets, repeat detection, prompt-injection hardening, leak-free errors, timeout, history sanitising; shared with the Sprint 15 cloud analyst.
- `server/lib/agentConfig.ts` (+ test, 7): validation of agent settings and keys, permission resolution, storage paths (`workspaces/{ws}/agents`, `workspaces/{ws}/agentSecrets`).
- `server/lib/agentIntegration.test.ts` (3): the whole chain over real sockets.
- `server/lib/analystService.ts` (+ test, 10): consent, allowance, refund, permissions, secrets (see Sprint 15).
- `server/lib/tokenVault.ts` extended (backwards compatible) with `sealAgentSecret` / `openAgentSecret`.

**Build steps (small prompts, after Sprint 15a-1):**
- **16a** server: agents API (create, edit, delete, list), key sealing, ask endpoint using the runner, rate limit and plan limit (agents per workspace); Firestore rules for `agents` (members read) and tests.
- **16b** screens: Settings → AI agents (add, edit, test connection), permissions picker, consent dialog, webhook secret shown once.
- **16c** AI Analyst page: agent picker, chat, "Numbers used" panel from the trace.
- **16d** webhook developer page: protocol description, signature verification snippets (Node, Python), test-call button.

## Sprint 16.5 — Installable app (PWA) ⬜

Goal: AdLens installs like an app on **Windows (Chrome, also Edge)** and on **iPhone/iPad (Add to Home Screen)**, opens in its own window with its own icon, and signs in reliably there. No app-store account or native code.

**Research (19 Oct 2026):**
- **Windows:** Chrome and Edge install web apps on Windows; Chromium needs a manifest (name, icons, start address, display mode) and HTTPS. Users can also install any site from the browser menu. The installed app gets a Start menu entry, taskbar icon, its own window, and updates itself from the site.
- **iPhone/iPad:** every browser on iOS uses Apple's engine (WebKit). iOS 26 opens every site added to the Home Screen as a web app by default, with no manifest or service worker required; a manifest still gives proper icons and behaviour. iOS has **no install prompt**, so the app must show its own "how to install" hint. Web push works only for apps added to the Home Screen (iOS 16.4+).
- **Not available on iPhone:** Chrome's built-in on-device model (Gemini Nano) does not exist on iOS, so Private mode (Sprint 15b) shows "not available" there and the cloud analyst is used.
- **Biggest risk: sign-in.** Firebase's Google and Microsoft sign-in uses a helper page hosted on `adlens-404e6.firebaseapp.com`, which is a different address from the app. Browsers increasingly block that cross-site storage, and installed iOS apps keep their storage separate from Safari. Firebase's documented fix is to serve the helper from the app's own address (set `authDomain` to the app's host and proxy `/__/auth/*` to Firebase).

**Decisions that shape the work:**
- **Domain first.** An installed app is tied to its address. Installing from `adlens-1.ai.studio` and moving to a custom domain later means every user must reinstall and sign in again. The same-origin sign-in helper also needs a domain AdLens controls. Plan: custom domain (Sprint 10 item) before inviting users to install; installing for the team and testing before that is fine.
- **Privacy of cached data.** The service worker caches the app's own files only. It never caches `/api/*` responses (they are per user and signed in) or sign-in pages, and everything is cleared on sign-out. An optional "last snapshot while offline" is a later, opt-in feature.
- **No new dependencies:** a small hand-written service worker built with esbuild (already in the project), logic in pure functions so it is unit-tested.

**Findings from the real build (25 Oct 2026):**
- Vite copies everything in `public/` into the build, so the manifest, icons and offline page ship automatically.
- The server currently sends `Cache-Control: max-age=0` for everything (hashed build files are re-checked on every load) and answers a **missing file with the app page and "200 OK"**, for example `/assets/missing.js`. The service worker is built to refuse to store that, but the server should return 404 for missing files.
- All 7 real build files (including the vendor chunks) are recognised by the worker's caching rule.

**Prep done (25 Oct 2026), tested and mutation-checked (60 new tests):**
- **Icons** (`public/icons/*`, generator `scripts/generate-icons.mjs`): 192, 512, maskable 512 (the logo is verified by code to stay inside Android's circular safe zone: 171.5 of 204.8 px), Apple touch 180 (opaque, since iOS fills transparent icons with black), favicons 32 and 16. Checked by eye on light, dark and circle-cropped backgrounds; a first version had a black fill bug that the preview caught.
- **Manifest** (`public/manifest.webmanifest`): stable `id`, scope, relative `start_url`, standalone, three shortcuts (Overview, AI Analyst, Connections) that are tested to point at real routes. 6 tests check icon files and sizes straight from the PNG headers; a seventh switches itself on when PWA-1 adds the tags to `index.html`.
- **Offline page** (`public/offline.html`): branded, light/dark, safe-area aware, no external files, no user data (tested).
- **Service worker** (`src/sw/swLogic.ts`, `src/sw/sw.ts`, built by `scripts/build-sw.mjs`, 3.6 KB, no dependencies): never touches `/api`, `/__/*`, non-GET, other sites or authorised requests; pages are stored under one fixed key so addresses are never kept; one-time-link pages are never stored; the app page returned for a missing file is never stored as a script; `no-store` responses are not stored; the previous build's cache is kept so open tabs survive an update; a new version waits for the user (no automatic skipWaiting). 26 tests, including a behavioural suite that builds and runs the real worker in a fake browser. Seven deliberate breaks of these rules were all caught (one gap in my tests was found this way and closed).
- **Update handling** (`src/pwa/updateManager.ts`, `src/pwa/register.ts`): no prompt or reload on first install, one reload only after the user accepts, no uninvited reload when another tab updates, update check when an installed app returns to the foreground, caches cleared on sign-out (other sites' caches untouched). 12 tests.
- **Install detection** (`src/pwa/installState.ts`): Windows Chrome/Edge get a real install button; iPhone and iPad (including an iPad that reports itself as a Mac) get a three-step guide, shown once in a banner and always in Settings. 6 tests with real browser identifiers.
- **Sign-in proxy** (`server/lib/authProxy.ts`): serves Firebase's helper files from the app's own address. Only GET/HEAD for `/__/auth/<file>` and `/__/firebase/init.json`; refuses traversal tricks; forwards no cookies, authorisation or referrer; drops Set-Cookie; never follows redirects; size, time (with its own timer) and rate limits; the return page is sent with `no-store`; `chooseAuthDomain` only ever picks an allow-listed address (a forged Host header cannot become the sign-in address). 10 tests including a real Express server; eight deliberate breaks all caught.

**Five small prompts (each about 10 minutes):**
- **PWA-1 Foundation:** page tags in `index.html` (manifest link, icons, `theme-color` pair for light and dark, Apple web-app tags, `viewport-fit=cover`); server headers: `/assets/*` long and immutable, missing files under `/assets` return 404, `sw.js`, `version.json`, manifest, offline page and `index.html` always revalidated, icons one day. The tags and files already exist; AI Studio only wires them.
- **PWA-2 Service worker:** add `node scripts/build-sw.mjs` to the build, call `registerServiceWorker` in `main.tsx`, "new version — Refresh" toast, clear caches on sign-out, offline banner and friendly offline errors, self-host the fonts with `@fontsource` packages (Vite emits hashed files the worker caches).
- **PWA-3 Install experience:** "Install AdLens" button and iPhone guide using `installState.ts` (profile menu, Settings, one-time dismissible banner).
- **PWA-4 Phone and window polish:** safe-area padding for the notch and home bar, status bar style, theme-color following the user's theme, no accidental pull-to-refresh, window title on Windows.
- **PWA-5 Sign-in inside the installed app:** register `registerAuthProxy` before the app fallback, use `chooseAuthDomain` in `/api/public-config`, switch (`AUTH_PROXY=on`), new redirect addresses with Google and Microsoft, Firebase authorized domains; verification and reset emails explained for installed apps.

**Test matrix (real devices):** Windows 11 Chrome tab and installed window; iPhone Safari tab and Home Screen app; iPhone Chrome added to Home Screen. In each: email sign-in, Google sign-in, reload, sign-out then sign-in as another user (no leftover data), update toast after a new release, offline page. Lighthouse installability audit must pass.

**Later and optional:** push notifications for alerts (installed apps only on iOS; Sprint 19 alerts), badge counts, Microsoft Store listing through PWABuilder, offline "last snapshot", custom title bar on Windows.

## Sprint 17 — MCP endpoint ⬜

Adopts #30.
- Streamable HTTP `/mcp`, read-only, scoped to the user's projects.
- **Phase A:** per-user access keys (Claude Code, Cursor, Codex, Gemini CLI).
- **Phase B:** OAuth 2.1 (dynamic client registration, PKCE) for Claude.ai and ChatGPT connectors.
- Per-client project access list and revoke.

## Sprint 18 — Scale & hardening ⬜

- **Shared cache and per-user rate limits** (Upstash Redis). The Google and Meta API quotas are shared by ALL AdLens users, so caching and request budgets are essential.
- Request budget tracking and a status page.
- Error monitoring, uptime alerts, audit log of connections and deletions.
- Scheduled email reports and anomaly alerts.
- Code-splitting, and a load test.
- Subscription billing: plans, checkout, upgrades/downgrades, invoices and plan limits enforced. Details parked; see Open decisions.

## Sprint 19 — Enterprise ⬜

- **Enterprise SSO:** SAML and OIDC (Okta, Microsoft Entra ID, Google Workspace SAML, OneLogin) per customer organisation. Needs the Firebase Authentication with Identity Platform upgrade.
- Domain-based routing: users with `@company.com` are sent to that company's identity provider. Optional enforced SSO per workspace.
- MFA (authenticator app / SMS); admin audit log; session management.
- Tied to an Enterprise subscription plan (pricing parked).

## Sprint 20 — Billing and plan limits 🧩 (20a–20c in `stage-7-billing-20abc` · 20e admin panel + Team in `stage-8-admin-team` · 20e-2 separate admin login and settings in `stage-9-admin-controls` · 20d customer plan card + admin Subscriptions tab in `stage-10-plan-view` · 20f not started)

**Decisions (27 Oct 2026):** manual invoicing first (no payment provider yet); customers in Bangladesh and overseas (prices in BDT and USD); three plans: Free, Pro, Business. Limits that change by plan: projects, AI questions, dashboards, saved reports, AI agents, team members, email summaries, plus the extras below.

**Plan limits (draft, to be edited by Zunaid before building):**

| Limit | Free | Pro | Business |
|---|---|---|---|
| Projects (sites) | 1 | 5 | 25 |
| AI questions per month | 10 | 300 | 1,500 |
| Dashboards / widgets each | 2 / 8 | 10 / 12 | 30 / 20 |
| Saved reports (per project) | 2 | 50 | 200 |
| Your own AI agents | 0 | 3 | 10 |
| Team members | 1 | 3 | 15 |
| Weekly email summary / unusual-day alerts | no | yes | yes |
| Connect AI tools (MCP keys) | 1 | 5 | 10 |
| Report history range (main date range start) | 10 days | 16 months | 16 months |
| CSV export | yes | yes | yes |
| Price (draft) | 0 | USD 19 / BDT 1,500 per month | USD 79 / BDT 6,500 per month |

Existing beta workspaces keep today's limits as a "Beta" plan until Zunaid moves them.

**How it works without a payment provider:**
- A workspace's plan, `planExpiresAt` and a private note live on the workspace (server-only fields; already protected by the rules).
- **Operator admin page** (operators only, `OPERATOR_EMAILS`): find a workspace, set plan and expiry, record "paid" with an invoice number and amount, see history. Every change goes to the audit log.
- **Billing page** (Settings → Plan and billing): current plan, usage against each limit, "Request upgrade" (saves a request and emails SUPPORT_EMAIL when Resend is set), list of invoices Zunaid recorded.
- **Enforcement on the server:** one `checkLimit` helper used by projects, dashboards, saved reports, agents, members, MCP keys, AI questions, and the summaries job. Friendly "Your plan allows N; upgrade to add more" errors with the limit and the plan name.
- **Expiry:** 7-day grace after `planExpiresAt`, then the workspace drops to Free. Nothing is deleted: extra items become read-only and the owner is told which to remove or re-upgrade.
- **Later, when a provider is chosen** (Paddle or Lemon Squeezy for overseas cards, SSLCommerz for local): a webhook only has to set the same plan fields, so nothing above changes.

**Small prompts (about 10 minutes each):**
- **20a** server: plan table, `checkLimit`, plan fields, expiry logic, tests (no screens).
- **20b** server: enforce limits in the existing routes, with error messages.
- **20c** server: operator plan admin API, invoice records, upgrade requests, audit entries.
- **20d** screens: Plan and billing page, usage bars, upgrade request, friendly limit messages.
- **20e** screens: operator admin page.
- **20f** legal pages (refund and cancellation wording), Pricing section on the landing page.

**Confirmed by Zunaid (27 Oct 2026):** Free = 10 AI questions, 2 saved reports, 10-day history. Refund policy: no refunds after 3 days (shown on the billing page; legal wording is 20f).

**Built so far (20a–20c, 460 tests):** `server/config/plans.ts` (limits, features, 7-day grace, history cutoff); plan end date stored on the workspace; limit checks for projects, AI questions, dashboards, widgets, saved reports, agents, AI-tool keys, email summaries (skipped, not deleted, when the plan lacks them), members (company-sign-in join) and report history (in `loadProject` and the MCP endpoint); `/api/billing` (customer view, upgrade request) and `/api/billing/admin/*` (operator: find workspaces, set plan and end date, record invoices, close requests, all audited). Safe by default: new workspaces still start on `beta` (`DEFAULT_NEW_WORKSPACE_PLAN`) until 20d, so nothing changes for anyone until you set a plan. The history limit checks only the main range start, not the comparison range, so "last 7 days vs previous 7" works on Free. Free users who pick "Last 28 days" get a friendly refusal until 20d clamps the presets in the UI.

**Built after that (20e + Team, 461 tests, 27 Oct 2026):**
- **Admin page** at `/admin` (sidebar "Admin", only for emails in `OPERATOR_EMAILS`): Overview (launch-readiness checks, health, usage), Workspaces (set plan and end date, record payment, people, projects), Upgrade requests, Users, Activity (audit trail). Not visually tested yet, only typechecked and built.
- **Team** (Settings → Workspace): add a person by email (existing account joins at once; unknown email becomes a pending invite accepted on first verified sign-in). Roles owner / admin / member (no read-only viewer yet). Only the owner grants admin; admins can remove members; the owner cannot be removed. Member count follows the plan (Free 1, Pro 3, Business 15, Beta 10).
- **Same-company offer:** the owner ticks "Offer colleagues with my company email the chance to join". Anyone verified with the same company email domain sees a popup and may accept ("Not now" hides it). Free-mail domains (Gmail, Outlook...) never match.
- Everyone uses their own Google and Meta connections, so a teammate needs access to the same GA4 property and Search Console in their own Google account.

**Admin controls (20e-2, 463 tests, 27 Oct 2026):** the admin panel moved to its own address `/admin-login` with a separate sign-in (email and password or Google) that opens a one-hour admin session; after that it asks again. The "Admin" link is no longer in the customer menu. New tabs: **Plans and prices** (edit every limit and the USD/BDT prices, put back shipped numbers, private plans for one customer such as "Convay team" with its own limits, a plan in use cannot be deleted), **Switches** (pause sign-ups, maintenance mode with message, turn Explore / Dashboards / AI agents / AI tools / AI Analyst / Teams off), **Operators** (add or remove operators; those in `OPERATOR_EMAILS` are locked owners; you cannot remove your own access). Settings are stored in Firestore `adminSettings/config` (server-only) and reach all servers within 30 seconds. Not visually tested yet.

**Plan view (20d-lite, 463 tests, 27 Oct 2026):** Settings → Workspace now starts with a "Plan and billing" card: current plan with status and paid-until date, usage bars (projects, AI questions this month, team members), every public plan side by side with the current one marked, "Request Pro/Business" for owners and admins, payments recorded, refund line. The admin panel has a **Subscriptions** tab: every person with their workspace, role, plan, status and paid-until date, filter by plan, search by email/name/workspace. Still to do in 20d: clamp Free date presets in the UI, flip `DEFAULT_NEW_WORKSPACE_PLAN` to free, 20f legal wording.

**Font choice (27 Oct 2026, 464 tests):** Settings → Appearance → Font: Plus Jakarta Sans (default), Mada, Poppins, Noto Sans, Inter, Roboto, and the device's own font. Saved per user with the other appearance settings (`appearance.fontFamily`); Bangla text always falls back to Noto Sans Bengali. Non-default fonts are bundled (`@fontsource/*`) but download only when picked. Delivered as `stage-11-fonts` (needs `package.json` and `package-lock.json`).

**Roles and permissions (Sprint 21, 27 Oct 2026, 466 tests):**
- **Workspace roles.** Four starter roles: Owner (everything, fixed), Admin (everything else), Moderator (view, edit content, AI Analyst, edit projects, manage AI agents, add and remove people, activity log), Member (view, edit content, AI Analyst, edit projects). Eleven permissions in total: view reports; edit dashboards and saved reports; use AI Analyst; create and edit projects; delete projects; manage AI agents; add and remove people; create roles and assign them; change workspace settings; request plan upgrades; see the activity log. Viewing is always included.
- **Custom roles.** People with "create roles and assign them" (Admins by default) make roles by ticking permissions, edit or delete them (people on a deleted role become Members), up to 20 per workspace, from Settings → Workspace → Roles and permissions. Roles are assigned in the Team list.
- **Safety rules.** Nobody can give out, edit or take away a role with more permissions than they have themselves. The owner cannot be changed or removed. A role id that no longer exists can only view. Enforced on the server for data screens, dashboards, saved reports, AI Analyst, projects, agents, workspace settings and logo, team, roles, billing requests and the activity log.
- **AdLens staff roles.** Admin panel → Staff: Super admin, Billing manager, Support, Settings manager. Tabs and actions follow the role. `OPERATOR_EMAILS` are always Super admins. A non-owner Super admin cannot remove their own staff-management access.
- Not covered yet: per-project roles (roles apply to the whole workspace), AI-tool (MCP) key access, CSV export (still a browser-side action, not a separate permission).

**Two-step verification and Google-only admin (Sprint 22, 27 Oct 2026, 471 tests):**
- **Why our own.** Firebase's built-in two-step needs the Identity Platform upgrade and the console only offered SMS codes (billed per message, no TOTP switch). So AdLens has its own authenticator-app two-step. It costs nothing and needs no card.
- **For everyone (optional).** Settings → Security → "Turn on two-step verification": scan the QR with Google Authenticator, Microsoft Authenticator, 1Password or Authy, type the first code, save ten single-use backup codes (shown once). After that every new sign-in shows a code screen before the app. Turning it off or making new backup codes needs a code. Email and password sign-in is unchanged; two-step comes after it.
- **How it works.** Secret stored encrypted (same key as the token vault) in the server-only Firestore collection `twoStep`; a `twoStep` flag on the sign-in token tells the server to ask; a signed proof (tied to the person and the sign-in, 30 days) travels in the `X-AdLens-2FA` header, so it works across many server copies. A used code cannot be reused; 8 wrong tries in 15 minutes lock the person out for 15 minutes (shared store); changes are in the activity log (never the secret).
- **Admin panel: Google only.** `/admin-login` has only "Continue with Google". The server refuses any other sign-in method for the panel (`ADMIN_GOOGLE_ONLY`), so Google's 2-Step Verification protects it. Admins must turn on 2-Step Verification in that Google account (the server cannot check that).
- **Lost phone.** Staff with "people in a workspace" permission can use Admin → Users → "Reset two-step" (switches it off and signs the person out everywhere). Do this only after confirming it is really them.
- Needs: nothing new to configure. Adds the `qrcode` package. Limits: a sign-in token made before someone turned two-step on stays valid for up to one hour without the flag; the in-app code screen still appears at once.

**Pre-launch security audit and hardening (Sprint 23, 27 Oct 2026, 475 tests):** full report in the Claude doc "AdLens Pre-Launch Security Audit". Fixed in `stage-14-hardening`: browser security headers (server and `vercel.json`, content-security policy in report-only mode), production dependency fixes (body-parser, gRPC override, fast-uri), two-step secrets now open with `TOKEN_ENCRYPTION_KEY_PREVIOUS`, sign-in `redirect` limited to AdLens paths, request limit 256 KB (logos), `X-Powered-By` removed. Must-do before publishing (settings): Firestore rules live and not in test mode, production environment settings, Upstash shared store, backups plus Firebase email-enumeration protection, check the CSP console lines once. Open: enforce CSP; the rest were fixed in Sprint 24.

**Open audit items fixed and flood check (Sprint 24, 27 Oct 2026):** (1) Error messages: about 18 routes no longer send raw error text to the browser (fixed messages instead). (2) Public `/api/health` now shows only what the sign-in screen needs (no list of missing secrets, no vault state). (3) Flood protection in `server/middleware/protect.ts`: per-address and per-person budgets, brake for repeated bad tokens, cap on requests in progress with a deadline each, slow-connection cutoffs (all settings in `docs/OPERATIONS.md`). (4) Summary emails: signed one-click unsubscribe link, page and `List-Unsubscribe` headers. (5) MCP keys and connected apps follow the "Use the AI Analyst" permission, checked again on every call. (6) Two-step: a server-side note (2 hours) closes the window where a token made before two-step was switched on had no flag. (7) Rules check now covers `twoStep` and the server-only collections (**`npm run test:rules` needs Java and internet to download the emulator; it could not run in my workspace, so run it once in AI Studio or locally**). Flood test against the built server: 3,000 requests from one address, 1,200 answered then 429 for the rest; junk-token flood fully refused; health answered in 1-2 ms throughout; 300 half-open connections cut off with 408 after about 15 s. 

**Require two-step for owners and admins (Sprint 25, 28 Oct 2026, 487 tests):** new workspace setting in Settings → Security (off by default). Turning it on needs your own two-step first (no lock-out). While on, an owner or admin without two-step can sign in and read the team list but gets `TWO_STEP_SETUP_REQUIRED` (403) on all project data, MCP keys and every change to the workspace, team and roles, and sees a banner pointing to Settings → Security; they cannot switch their own two-step off (`REQUIRED_BY_WORKSPACE`). Members and moderators are not asked. Changes are logged. The browser cannot write the field directly (rules check added). Code: `server/lib/twoStepPolicy.ts`, `WorkspaceTwoStepRule.tsx`, `TwoStepRuleBanner.tsx`.

**Sign-up email and workspace-creation fixes (Sprint 26, 28 Oct 2026, 489 tests):** (1) If Firebase refuses the verification email's return address (domain not in Authorized domains) the app now resends the plain version, so the email still goes out; sign-up no longer fails after the account is made, and the verify page shows a clear reason when resend fails. (2) New owner-only `GET /api/ops/diagnose` writes, reads and deletes a scratch Firestore document and explains in plain words what is wrong (no database, missing service-account role, bad key, quota). (3) The workspace-creation failure now logs its real database error code on the server (and goes to the error webhook) instead of being silent. Settings checks are in the chat answer.

**Plans, wording and defaults (Sprint 27, 28 Oct 2026, 495 tests):** (1) The date picker follows the plan's history limit (`historyDays` now comes with each workspace): presets that reach too far back are greyed out with "(upgrade)", a saved long preset becomes the last 7 days, a custom range is cut to the oldest allowed day, and a small note says why. The server still refuses older ranges. (2) New workspaces start on **Free** (was beta); `DEFAULT_NEW_WORKSPACE_PLAN` changes it; existing workspaces are untouched; tests run on beta through `scripts/env-for-tests.mjs` and the real default has its own test. (3) Terms of Service: new "Plans, payments, cancellation and refunds" section (invoice payment, no auto-renewal, 7-day grace, move to Free, 3-day refund rule); last-updated date 28 October 2026. (4) Home page: Pricing section filled from the server's plan list (`/api/public-config` now includes `plans`), so admin-panel changes show up. Wording is a plain-language draft: have a lawyer read it before you charge money; confirm that refunds are given within 3 days (you confirmed only "no refunds after 3 days").

**Grafana-style roadmap (Sprints 28–29, 28 Oct 2026, Claude pushes to GitHub directly, 509 tests):** Claude now commits straight to `main` (always fetch + rebase first, never force-push; AI Studio: pull the latest, then redeploy). Roadmap: (1) better dashboards, (2) variables and filters, (3) guided custom query builder, (4) more data sources (Google Sheets/CSV first), (5) rule-based alerts, (6) sharing (read-only links, scheduled snapshots).
- **Sprint 28 (step 1, done):** Duplicate button (`43904a6`); per-panel time range, last 7/14/28/90 days ending on the page's end date (`9a58e5d`, optional `days` on a widget, validated on the server); four new panel types: stacked bars, pie, gauge (with a "set target" button; percent metrics default to 100) and heat map (`bb8d7a3`, helpers in `src/utils/chartShapes.ts`); drag to move and drag to resize in edit mode on desktop, arrow buttons kept as the fallback (`eece3a9`).
- **Sprint 29 (step 2, done):** a filter bar above every dashboard: Country, Campaign (GA4 only) and Device. Filters live in the page address (so a filtered view can be bookmarked), apply to every panel that has the field and are never saved into the dashboard. Search Console country filters now accept a name or a 2-letter code (converted to the 3-letter code Search Console wants). The project dropdown already existed (workspace/project switcher), dashboards are per project.
- **Sprint 30 (step 3, done):** Explore (the guided query builder: pick breakdowns, numbers, filters, sort; read-only; saved-report limit follows the plan) already covered GA4 and Search Console; it now also covers **Meta Ads**: dimensions date, campaign, ad set, ad, country, age, gender, platform, device; metrics spend, impressions, reach, frequency, clicks, link clicks, CTR, CPC, CPM; filters on campaign/ad set/ad name. Works in saved reports and dashboard panels too (new `POST /api/explore/meta/run`, uses the person's own Facebook connection and the project's ad account). The dashboard Campaign filter also applies to Meta panels. Not yet: AI-built widgets still use GA4/Search Console only.
- **Sprint 31 (step 4a, done): uploaded data (CSV).** New fourth Explore source, "Uploaded data": choose a CSV file (header row, up to 5,000 rows, 20 columns, about 240 KB; comma, semicolon or tab; dates as YYYY-MM-DD; numbers may carry commas and $ £ € ৳ %). Column types are guessed (date, number, text). Build reports like any other source: break down by columns, add up / average / smallest / largest / count the numbers, filters, sort; the date picker applies to the table's date column. Works in saved reports and dashboard panels. Tables are stored per project (one document each, read-only afterwards); plan limit **uploaded tables per project**: Free 1, Pro 10, Business 50 (editable in the admin plan settings). API: `GET/POST /api/datasets`, `GET/DELETE /api/datasets/:id`, `POST /api/explore/data/run`. Dashboard-wide filters do not apply to uploaded tables. Not yet: replacing a table's contents, Google Sheets link (next), editing columns.
- **Sprint 32 (step 4b, done): connectors.** Explore's last tab is now "Other sources" and starts with a **Connect a data source** gallery. Live: **Google Sheets** (paste a link to a sheet shared as "Anyone with the link can view"; one tab), **Shopify** (store address + Admin API token with read_orders; last 90 days of orders) and **WooCommerce** (site address + read-only consumer key and secret; last 90 days). The result is a table like an uploaded CSV (same Explore, saved reports, dashboards, plan limit), with a **Refresh** button that fetches again. Listed as "soon" (button disabled, CSV upload is the stopgap): LinkedIn Ads, TikTok Ads, Google Ads, Microsoft Advertising, X Ads, Pinterest Ads, Snapchat Ads, Reddit Ads, YouTube Analytics, Mailchimp, Klaviyo, HubSpot, Stripe. Safety: all outside requests go through the existing guarded request (public addresses only, no redirects except Sheets to Google hosts, size and time limits); Shopify store names are checked against *.myshopify.com and the token is sent only to that store; WooCommerce needs https; secrets are encrypted with the server key (same sealing as agent keys, bound to the person who connected) and never sent back to the browser. API: `GET /api/datasets/connectors`, `POST /api/datasets/connect`, `POST /api/datasets/:id/refresh`. Shopify API version is pinned in `SHOPIFY_API_VERSION` (server/lib/connectors.ts); bump it about once a year. Not yet tested against real stores (tests use fake answers): try one real Shopify/Woo/Sheet and report problems.
- **Sprint 32b (step 4c, done): manual connection.** New live connector **Custom link (CSV or JSON)**: any https address that answers a plain GET with CSV text or a JSON list; optional sign-in header (name plain, value encrypted); optional "where the rows are" path for JSON (otherwise the first list of objects, up to 3 levels down, is used); nested objects become `a.b` columns. Same limits as other tables (5,000 rows, 20 columns), refreshable, same safety rules (https only, port 443, public addresses only, no redirects, blocked header names like Host).
- **Next in step 4:** the "soon" platforms, each needs that platform's developer approval first (LinkedIn Marketing API, TikTok for Business Marketing API, Google Ads developer token); once approved, each becomes one more entry in `server/lib/connectors.ts` plus its OAuth sign-in.

**Open items:** confirm Pro/Business numbers and prices; whether Business includes company sign-in later; tax and invoice details for Bangladesh and overseas customers (ask the accountant).

---

## Delivery log — 26 Oct 2026 (built by Claude, 371/371 tests, tsc, colour check and build all clean)

Upload in this order (each zip is applied over the repo, then committed):

| Order | Zip | Contents | Commit message |
|---|---|---|---|
| 1 | `stage-1-phone-polish-and-signin-proxy` | PWA-4 phone polish, PWA-5 sign-in proxy (flag off) | PWA-4 and PWA-5 |
| 2 | `stage-2-explore` | Sprint 13: Explore builders, saved reports, CSV export | Sprint 13: Explore report builder |
| 3 | `stage-3-dashboards` | Sprint 14: dashboards, 4 templates, presentation mode | Sprint 14: dashboards |
| 4 | `stage-4-ai-agents` | Sprint 16a–d: bring-your-own agents, webhook signing | Sprint 16: bring-your-own AI agents |
| 5 | `stage-5-ai-analyst-15` | Sprint 15a-3 describe-a-widget, 15b Private mode | Sprint 15: describe-a-widget and on-device private mode |
| 6 | `stage-6-sprints-10-to-19` | Sprints 10, 11, 12, 15c, 17, 18, 19 (see below) | Sprints 10-19: launch readiness, search intelligence, MCP, hardening, enterprise SSO |
| 6b | `stage-6b-missing-files` | 20 files that did not reach GitHub from stages 1 and 6 | Add missing files |
| 7 | `stage-7-billing-20abc` | Sprint 20a–20c: plans, limits, billing and operator API | Sprint 20: plans and limits (server) |
| 18 | `stage-18-plans-and-wording` | Sprint 27: Free-plan date limit in the picker, Free as default plan, Terms plans/refunds section, Pricing on the home page | Sprint 27: plan limits in the date picker, Free default, pricing and refund wording |
| 19–20 | pushed directly to GitHub (commits `43904a6` to this one) | Sprints 28–29: Grafana-style dashboards (duplicate, per-panel range, 4 new chart types, drag and drop) and dashboard filters | see Sprint 28–29 note |
| 17 | `stage-17-signup-fixes` | Sprint 26: verification email fallback, owner database check, real cause logged when workspace creation fails | Sprint 26: sign-up email and workspace fixes |
| 16 | `stage-16-two-step-rule` | Sprint 25: workspace setting that requires two-step for owners and admins | Sprint 25: require two-step for owners and admins |
| 15 | `stage-15-open-fixes` | Sprint 24: flood protection, unsubscribe link, generic errors, trimmed health page, MCP keys follow roles, two-step stale-token fix, rules checks | Sprint 24: open audit fixes and flood protection |
| 14 | `stage-14-hardening` | Sprint 23: security headers, dependency fixes, 2FA key-rotation fix, safe redirect, logo size limit | Sprint 23: security hardening |
| 13 | `stage-13-two-step` | Sprint 22: authenticator-app two-step for everyone, Google-only admin login (adds `qrcode`) | Sprint 22: two-step verification and Google-only admin |
| 12 | `stage-12-roles` | Sprint 21: workspace roles and permissions, custom roles, AdLens staff roles | Sprint 21: roles and permissions |
| 11 | `stage-11-fonts` | Font choice in Appearance (adds 5 font packages) | Add font choice |
| 10 | `stage-10-plan-view` | Customer Plan and billing card, admin Subscriptions tab (repeats stage-7 to 9 files) | Sprint 20d: plan view and subscriptions tab |
| 9 | `stage-9-admin-controls` | Sprint 20e-2: separate admin login, plan/price editor, switches, operators (also repeats stage-7 and stage-8 files) | Sprint 20e-2: admin login and controls |
| 8 | `stage-8-admin-team` | Sprint 20e admin panel, Team, same-company join offers (also repeats stage-7 files) | Sprint 20e: admin panel and team |

Deviations from the original plan: dashboards use inline report specs and button-based move/resize; 4 templates (plan said 8), no workspace templates or pin-to-dashboard; agents UI lives at `/agents` (not Settings); engine bar sits on the analyst page; on-device mode shortlists reports by keyword and compacts them (no model tool-calling); added `POST /api/reports/run`; content limits live in `CONTENT_LIMITS` (beta: 10 dashboards, 12 widgets each, 50 saved reports, 3 agents).

---

### Stage 6 — what is in `stage-6-sprints-10-to-19` (26 Oct 2026; clean-room check on a fresh clone with stages 1–6: `npm ci`, tsc, **456/456 tests**, colour check and build all clean)

- **Sprint 10:** landing, Privacy Policy, Terms, Meta data-deletion callback and instructions page, cookie notice, `docs/LAUNCH-CHECKLIST.md`, `scripts/launch-readiness.ts`. `LegalPlaceholderPage.tsx` is deleted (the zip cannot delete files: remove `src/pages/LegalPlaceholderPage.tsx` by hand; it is unused and harmless).
- **Sprints 11–12:** trending queries, SEO opportunities, cannibalisation, sitemaps, host breakdown, page detail, pages table (GA4 + Search Console), site snapshot at `/snapshot`, Meta ↔ GA4 cross-channel (uses only the user's own Meta token).
- **Sprint 15c:** optional WebGPU model. WebLLM is not bundled; the owner hosts the module and sets `VITE_WEBLLM_MODULE_URL` (https or same-origin only). Wrapped as the same `LanguageModelLike`, so the Private-mode privacy rule is unchanged. JSON answers are checked against the report numbers; unverified figures are flagged. Verify the model IDs in `MODEL_CATALOG` against the hosted WebLLM version.
- **Sprint 17:** MCP over Streamable HTTP at `POST /mcp` (read-only, no SDK dependency). Phase A keys `adl_` (max 10 per user, SHA-256 hashed). Phase B OAuth 2.1 (public clients, PKCE S256, `adlo_`/`adlr_` tokens). 60 requests per minute per credential. Screens: `/mcp-access`, `/mcp-access/authorize`; sidebar "Connect AI tools".
- **Sprint 18:** shared store (memory or Upstash) behind a response cache for GA4, Search Console and Meta; audit log (Firestore `auditLog`, anonymised on account deletion); usage meter; error reporter (`ERROR_WEBHOOK_URL`, secrets scrubbed, de-duplicated); weekly email summaries and unusual-day alerts (Resend, `CRON_SECRET`-protected `POST /api/ops/run-digests`, UTC dates); `GET /api/ops/ready`, `/api/ops/audit`, `/api/ops/usage` (operators only); code-splitting (main bundle about 735 KB → about 212 KB); `scripts/load-test.ts`; `docs/OPERATIONS.md`.
- **Sprint 19:** company sign-in (SAML/OIDC) with DNS-verified domains (`_adlens-verify.<domain>`), provider-to-domain binding, free-mail blocking, "Require SSO" with a test-first lock-out guard, optional MFA requirement, just-in-time join, TOTP MFA screens, "Sign out everywhere", workspace and personal activity cards, `/sign-in-blocked` page. Needs the Firebase Identity Platform upgrade and TOTP enabled.
- **New server-only Firestore collections** (default-deny rules, no rules change): `auditLog`, `digestSubscriptions`, `orgSso`, `ssoDomains`, `mcpKeys`, `mcpClients`, `mcpAuthCodes`, `mcpTokens`, `metaUserLinks`, `dataDeletionRequests`.
- **Deviations:** per-session list replaced by "Sign out everywhere" (Firebase has no session list); billing and plan limits parked; usage status has no page; email summary dates are UTC.

## Decisions log

| Date | Decision |
|------|----------|
| 26 Oct 2026 | Sprint 15c: WebLLM is not bundled; the owner self-hosts the module (`VITE_WEBLLM_MODULE_URL`), because a third-party CDN module would run with the page's sign-in privileges |
| 26 Oct 2026 | MCP implemented directly over Streamable HTTP (no SDK); Phase A keys and Phase B OAuth 2.1 in one sprint; credentials stored only as SHA-256 hashes |
| 26 Oct 2026 | Shared store: Upstash REST when configured, in-memory otherwise; same interface for cache, rate limits and sign-out-everywhere markers |
| 26 Oct 2026 | Enterprise SSO safety: a company sign-in counts only if the email domain is DNS-verified for that exact provider; free-mail domains cannot be claimed; "Require SSO" only when the owner is signed in through that provider |
| 26 Oct 2026 | If the domain-rule lookup fails, ordinary users still get in; enterprise-provider tokens are refused |
| 26 Oct 2026 | Billing and plan limits stay parked (not built in Sprint 18); usage status is an operator API only |
| 26 Oct 2026 | Site snapshot is a separate page (`/snapshot`); cross-channel uses only the user's own Meta connection |
| 26 Oct 2026 | Private-mode history: turns marked private are never sent to the cloud or to custom agents (`historyForCloud`) |
| 26 Oct 2026 | `AUTH_PROXY` flag defaults to off until a domain is chosen |
| 26 Oct 2026 | Saved reports, dashboards and agents are stored server-only (Admin SDK); Firestore rules unchanged (deny by default) |
| 26 Oct 2026 | CSV export neutralises spreadsheet formulas; Explore reports are registered in the report registry so the AI can use them |
| 18 Oct 2026 | Name: **AdLens** (KardIQ rejected, since it's already the Amar-Fit app name) |
| 18 Oct 2026 | Platform: **website**, not Android; restarted in repo `AdLens` |
| 18 Oct 2026 | Data access: **direct APIs via Google Cloud** (not connector services or CSV upload) |
| 18 Oct 2026 | Sessions: **encrypted cookie, no database**; each user signs in with their own Google account |
| 18 Oct 2026 | Hosting: AI Studio now → **Vercel** after Sprint 4 |
| 18 Oct 2026 | Workflow: AI Studio builds; Claude verifies and prepares next-sprint files in parallel |
| 18 Oct 2026 | Adopted 13 features from Analytics MCP Server (#6, #8–12, #14, #19, #23, #24, #26, #27, #30); plan expanded from 9 to 13 sprints |
| 18 Oct 2026 | All reports built as shared server-side report functions, reused by UI, AI analyst, agents and MCP |
| 18 Oct 2026 | Meta access via System User token (read-only, server-side), not per-user Meta sign-in; Graph API v26.0 |
| 18 Oct 2026 | Files enter the repo only through AI Studio (direct GitHub uploads blocked the Sprint 4 push) |
| 19 Oct 2026 | Superseded: AI Studio can pull from GitHub (tested by Zunaid). Claude's files are uploaded to GitHub, then pulled into AI Studio, only when AI Studio has no unpushed work |
| 18 Oct 2026 | Meta connection moves to a "Connect Facebook" button (Facebook Login for Business, per-user token, ad account picker) |
| 18 Oct 2026 | ~~Database + auth: Supabase~~ → replaced by **Firebase** (Authentication, Firestore, Cloud Storage) in the existing AdLens Google Cloud project; Firestore in asia-southeast1. Hosting stays on Vercel |
| 18 Oct 2026 | Uploads = profile pictures and workspace logos (Cloud Storage); settings and configuration stored in Firestore and synced across devices. CSV data imports not planned |
| 18 Oct 2026 | SSO in two stages: social SSO (Google, Microsoft) in Sprint 7A; enterprise SAML/OIDC in Sprint 17 |
| 18 Oct 2026 | Public-mode safeguard: the Meta system-user token is usable only by allow-listed emails, so other users can never see Synesis IT ad accounts |
| 25 Oct 2026 | PWA prep built and tested (icons, manifest, offline page, service worker with a behavioural test suite, update logic, install detection, sign-in proxy). The worker keeps the app's own files only and waits for the user before updating |
| 25 Oct 2026 | **Installable app (PWA)** planned as Sprint 16.5 (5 small prompts): Windows Chrome and iPhone Home Screen. Decided: custom domain before inviting installs; service worker caches app files only, never `/api` or sign-in pages; same-origin Firebase sign-in helper for installed apps; no new dependencies |
| 19 Oct 2026 | Colour migration is automated by a tested script (2,341 of 2,344 classes); Sprint 8 is now four prompts. Cool-tinted default presets keep the current slate look; input borders and faint text deliberately meet WCAG non-text contrast |
| 19 Oct 2026 | Sprint 8 was first split into six small prompts because the app has ~607 hard-coded colour classes that must move to named colour roles (page, surface, line, fg, accent…) before a user theme can change anything |
| 19 Oct 2026 | Custom AI agents: Gemini, OpenAI-compatible and signed webhooks; the user's own keys are encrypted with the vault; endpoints are SSRF-guarded; each agent only gets reports its allowed AND connected sources cover |
| 19 Oct 2026 | **AI is hybrid:** cloud Gemini by default; on-device "Private mode" (Chrome built-in Gemini Nano first, WebLLM later if needed) is opt-in; private mode never reaches the cloud without the user's explicit action |
| 19 Oct 2026 | Token vault: per-user, owner-bound encryption in server-only Firestore collection `connections`; each person uses their own Google/Meta connection; optional TOKEN_ENCRYPTION_KEY_PREVIOUS for key rotation |
| 18 Oct 2026 | Business model: **subscription** (details parked). Sprint 7 adds plan fields and usage counters; billing built in Sprint 16 |
| 18 Oct 2026 | **AdLens goes public:** anyone can sign up and connect their own accounts. Accounts, database and projects move to Sprint 7; launch readiness and platform reviews added as Sprint 9; plan now 16 sprints |
| 19 Oct 2026 | UI/UX overhaul: **design system + appearance settings** (themes, custom colours, font size, density, chart palettes) as new Sprint 8; **custom dashboards with template gallery + drag-and-drop builder** as new Sprint 14. Later sprints renumbered (now 19 sprints) |
| 19 Oct 2026 | **Hosting: AI Studio only; Vercel dropped.** Vercel's older Node runtime crashed the server (ERR_REQUIRE_ESM from firebase-admin → jwks-rsa → jose 6). `vercel.json`/`api/index.ts` are harmless and can be removed later. Custom domain on AI Studio hosting to be confirmed before Sprint 10 (needed for Google verification and branded email) |
| 19 Oct 2026 | **No Blaze plan / no Cloud Storage.** Profile pictures and workspace logos are stored as small base64 data URLs in Firestore (`users/{uid}/assets/avatar` ≤ 100k chars, `workspaces/{ws}/assets/logo` ≤ 200k chars), resized in the browser by `src/utils/imageAssets.ts`. Storage rules and tests removed. Revisit if Blaze is adopted later (Sprint 18/19) |

## Open decisions

- **Custom domain timing (Sprint 16.5 / 10):** before inviting users to install (recommended), or accept a reinstall later.
- **Offline scope (Sprint 16.5):** offline page only (default), or later an opt-in "last snapshot" of the most recent dashboard.
- **Microsoft Store listing (optional):** only if you want AdLens to appear in the Store as well as installing from Chrome.

- **Theme presets and fonts (Sprint 8):** final list of preset themes and fonts; whether the default stays deep blue.
- **Template list (Sprint 14):** confirm the 8 starter templates; dashboards per project per plan.

- **Extra SSO providers:** Apple, GitHub, Facebook sign-in (optional).

- **Domain (Sprint 10):** a dedicated domain (e.g. adlens.app or similar; check availability and trademark) or a subdomain such as adlens.synesisit.com.bd.
- **Legal entity and support contact (Sprint 10):** Synesis IT PLC as the app owner for Google, Meta and the Privacy Policy.
- **Subscription details (parked):** plans, prices, limits per plan and payment provider. Revisit before Sprint 18.
- **MCP auth (Sprint 17):** decided and built: Phase A and Phase B both in.
- **Ops secrets (Sprint 18, optional):** Upstash, `ERROR_WEBHOOK_URL`, `OPERATOR_EMAILS`, `RESEND_API_KEY` + `MAIL_FROM`, `CRON_SECRET` + a daily scheduler call, `VITE_WEBLLM_MODULE_URL`. See `docs/OPERATIONS.md`.
- **Sprint 19 (27 Oct 2026):** Firebase upgraded to Identity Platform. Company sign-in (SAML) and two-step codes are **skipped for now**: the console showed only SMS multi-factor (billed per message), no TOTP switch. Revisit when a company customer needs it. Stage 1 and 6 uploads were completed with `stage-6b-missing-files.zip` (GitHub web upload stops at 100 files); repo verified green at 933549a (456 tests).

## Known issues and backlog

- **Project deletion:** `deleteProject` does not delete project subcollections (savedReports, dashboards); wire `deleteAll`.
- **Wrong error text:** `?error=invalid_state` after a Google failure shows the Facebook message.
- **Untested in real browsers:** Private mode (Chrome Gemini Nano) and the describe-a-widget box need a live check.
- **Old Facebook connections** are not linked to a Facebook user id until the person reconnects.
- **Stale tabs after a deploy:** a tab opened before a release may need a reload (lazy-loaded pages).
- **WebLLM model IDs** in `MODEL_CATALOG` must be verified against the hosted version.
- **Stale file:** `src/pages/LegalPlaceholderPage.tsx` is unused; delete it by hand.
- **Fonts load from Google Fonts:** blocks a fully offline shell and sends visitors' addresses to Google. Self-host them in PWA-2.

- **Verification emails not arriving (19 Oct 2026):** being diagnosed. Check that the account exists in Firebase → Users, then use Firebase's own "Reset password" email to test delivery. A branded sender domain is planned for Sprint 10.
- **Microsoft sign-in:** not configured yet. Hide the button until it is (AUTH_PROVIDERS env).

- **Weekly re-sign-in:** Google Testing mode expires sign-ins every 7 days. Fixed when the Google app is verified and published to Production (Sprint 10 track). "Internal" is no longer an option for a public app.
- **Shared store:** resolved in Sprint 18 (set the Upstash secrets to share cache across instances).
- **Preview deployments:** Vercel previews get different URLs, so only the production domain can do Google sign-in.
- **API quotas:** Sprints 6–13 add many more GA4/Search Console calls; caching and request budgets matter more (Sprint 18).
- **Bundle size:** resolved in Sprint 18 (main bundle about 212 KB).
- **Vercel plan:** a public app needs Vercel Pro (Hobby is non-commercial).
- **Hard-coded Convay:** mock data and copy still reference Convay. Removed in Sprint 7 (demo project instead).
