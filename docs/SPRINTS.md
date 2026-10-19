# AdLens — Sprint Tracker

**AdLens · Marketing Intelligence Console**
A public, multi-user console. Anyone can sign up, connect their own Google Analytics 4, Search Console and Meta Ads accounts, and analyse their own sites with AI. (Convay is the first site it was built and tested on.)

- **Repo:** github.com/zunaidshuruk/AdLens
- **Live app:** https://adlens-1.ai.studio (AI Studio hosting). Vercel was tried and dropped on 19 Oct 2026.
- **Built with:** Google AI Studio (Build mode); planning and verification in Claude
- **Last updated:** 18 Oct 2026

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
| 7 | Accounts & data on **Firebase**: 7A auth · 7B Firestore projects · 7B-2 settings + uploads · 7C token vault | ✅ 7A + 7B verified · 7B-2 next | `9b447e8` (7A), `3c829da` (7B) |
| 8 | **Design system, appearance & theming** (UI/UX overhaul) | ⬜ Planned | — |
| 9 | Connections v2: Connect Facebook + project setup wizard | 🧩 Prep done (domain matcher + Facebook sign-in helpers) | — |
| 10 | Public-launch readiness + platform reviews | ⬜ Planned | — |
| 11 | Search intelligence | 🧩 Prep done (insights + host breakdown + tests) | — |
| 12 | Page detail + site snapshot (cross-channel) | 🧩 Prep done (Meta ↔ GA4 campaign matcher) | — |
| 13 | Flexible report builders (Explore) | ⬜ Planned | — |
| 14 | **Custom dashboards: builder + template gallery** | ⬜ Planned | — |
| 15 | Built-in AI analyst (Gemini) | ⬜ Planned | — |
| 16 | Bring-your-own AI agents | ⬜ Planned | — |
| 17 | MCP endpoint | ⬜ Planned | — |
| 18 | Scale & hardening (quotas, shared cache, monitoring, reports, alerts) | ⬜ Planned | — |
| 19 | Enterprise: SAML/OIDC single sign-on, MFA, audit log | ⬜ Planned | — |

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

### 7C — Token vault + account lifecycle

- Google/Meta tokens move from the cookie to a **server-only** Firestore collection `connections/{id}` (rules deny all browser access). Tokens are encrypted with AES-256-GCM before storage, and tied to the signed-in user.
- **Delete account:** revoke Google/Meta tokens, delete Firestore data and uploads, then delete the Firebase Auth user.
- Usage counters written by the server.

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

Parallel prep candidates:
- theme engine (accent → full palette in OKLCH, dark-mode derivation, WCAG contrast checker/fixer, font-scale tokens);
- Firestore settings validation for appearance (extends the 7B rules).

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

## Sprint 13 — Flexible report builders ("Explore") ⬜

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

## Sprint 15 — Built-in AI analyst (Gemini) ⬜

- Gemini function calling over all report functions, using the snapshot-first strategy.
- **"Describe a widget":** generate a dashboard widget from plain language, preview it, then add it to a dashboard (Sprint 14 builder).
- Per-user AI usage limits, read from the workspace plan, so one user can't run up costs for everyone.
- First-use consent: "Your analytics data will be sent to Google Gemini to answer your questions."

## Sprint 16 — Bring-your-own AI agents ⬜

- Agent registry: Gemini, OpenAI-compatible endpoints and webhooks. Per-agent system prompt and data-source permissions.
- Users supply their own AI API keys, stored encrypted.
- Explicit consent before any data goes to a third-party AI.

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

---

## Decisions log

| Date | Decision |
|------|----------|
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
| 18 Oct 2026 | Business model: **subscription** (details parked). Sprint 7 adds plan fields and usage counters; billing built in Sprint 16 |
| 18 Oct 2026 | **AdLens goes public:** anyone can sign up and connect their own accounts. Accounts, database and projects move to Sprint 7; launch readiness and platform reviews added as Sprint 9; plan now 16 sprints |
| 19 Oct 2026 | UI/UX overhaul: **design system + appearance settings** (themes, custom colours, font size, density, chart palettes) as new Sprint 8; **custom dashboards with template gallery + drag-and-drop builder** as new Sprint 14. Later sprints renumbered (now 19 sprints) |
| 19 Oct 2026 | **Hosting: AI Studio only; Vercel dropped.** Vercel's older Node runtime crashed the server (ERR_REQUIRE_ESM from firebase-admin → jwks-rsa → jose 6). `vercel.json`/`api/index.ts` are harmless and can be removed later. Custom domain on AI Studio hosting to be confirmed before Sprint 10 (needed for Google verification and branded email) |

## Open decisions

- **Theme presets and fonts (Sprint 8):** final list of preset themes and fonts; whether the default stays deep blue.
- **Template list (Sprint 14):** confirm the 8 starter templates; dashboards per project per plan.

- **Extra SSO providers:** Apple, GitHub, Facebook sign-in (optional).

- **Domain (Sprint 10):** a dedicated domain (e.g. adlens.app or similar; check availability and trademark) or a subdomain such as adlens.synesisit.com.bd.
- **Legal entity and support contact (Sprint 10):** Synesis IT PLC as the app owner for Google, Meta and the Privacy Policy.
- **Subscription details (parked):** plans, prices, limits per plan and payment provider. Revisit before Sprint 18.
- **MCP auth (Sprint 17):** Phase A (access keys) first, Phase B (OAuth 2.1) after.

## Known issues and backlog

- **Verification emails not arriving (19 Oct 2026):** being diagnosed. Check that the account exists in Firebase → Users, then use Firebase's own "Reset password" email to test delivery. A branded sender domain is planned for Sprint 10.
- **Microsoft sign-in:** not configured yet. Hide the button until it is (AUTH_PROVIDERS env).

- **Weekly re-sign-in:** Google Testing mode expires sign-ins every 7 days. Fixed when the Google app is verified and published to Production (Sprint 10 track). "Internal" is no longer an option for a public app.
- **Vercel memory:** the in-memory cache and rate limiter are per-instance on Vercel. A shared store comes in Sprint 18.
- **Preview deployments:** Vercel previews get different URLs, so only the production domain can do Google sign-in.
- **API quotas:** Sprints 6–13 add many more GA4/Search Console calls; caching and request budgets matter more (Sprint 18).
- **Bundle size:** the frontend bundle is about 735 KB. Code-splitting comes in Sprint 18.
- **Vercel plan:** a public app needs Vercel Pro (Hobby is non-commercial).
- **Hard-coded Convay:** mock data and copy still reference Convay. Removed in Sprint 7 (demo project instead).
