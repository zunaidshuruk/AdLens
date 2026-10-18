# AdLens — Sprint Tracker

**AdLens · Marketing Intelligence Console**
Unified console for Google Analytics 4, Google Search Console and Meta Ads, with an AI analyst layer.
Tracked website: Convay (convay.com)

- **Repo:** github.com/zunaidshuruk/AdLens
- **Live app:** https://adlens-1.ai.studio (AI Studio hosting; moving to Vercel after Sprint 4)
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
| 4 | Live Search Console data | ⚠️ Built in AI Studio, not yet on GitHub | — |
| 5 | Live Meta Ads data | 🔄 Prompt sent · mapper on GitHub | — |
| 6 | Traffic intelligence + AI referral traffic | 🧩 Prep done (classifier + tests) | — |
| 7 | Search intelligence | 🧩 Prep done (insights + host breakdown + tests) | — |
| 8 | Page detail + site snapshot (cross-channel) | ⬜ Planned | — |
| 9 | Flexible report builders (Explore) | ⬜ Planned | — |
| 10 | Built-in AI analyst (Gemini) | ⬜ Planned | — |
| 11 | Database + bring-your-own AI agents | ⬜ Planned | — |
| 12 | MCP endpoint | ⬜ Planned | — |
| 13 | Reports, alerts, export, hardening | ⬜ Planned | — |

Legend: ⚠️ needs attention · ✅ done · 🔄 in progress · 🧩 prep work done in parallel · ⏳ waiting on setup · ⬜ not started

### Features adopted from Analytics MCP Server (planned 18 Oct 2026)

| Ref | Feature | Sprint |
|-----|---------|--------|
| #6 | Host breakdown (traffic, search and sitemaps per hostname) | 7 |
| #8–9 | AI referral traffic (by assistant, landing page, day; key events; share of sessions) | 6 |
| #10 | Source groups (AI assistants, Search, Social, Email, Referral, Paid, Direct/unknown) | 6 |
| #11 | Site snapshot (one-screen summary across sources, with rising/falling items) | 8 |
| #12 | Full traffic breakdowns (channel, source/medium, referrer, landing page, country, device, date + filters) | 6 |
| #14 | Page detail (one page: sources, AI share, countries, devices, trend, ranking queries) | 8 |
| #19 | Flexible GA4 report builder | 9 |
| #23 | SEO opportunities (positions 5–20 with below-typical CTR; cannibalisation) | 7 |
| #24 | Trending queries (rising, falling, new, lost; topic grouping) | 7 |
| #26 | Flexible Search Console report builder | 9 |
| #27 | Sitemaps (read-only list with errors and warnings) | 7 |
| #30 | MCP endpoint (external AI clients query AdLens) | 12 |

---

## How we work

1. **Planning (Claude):** design the sprint, write the AI Studio prompt.
2. **Building (AI Studio):** paste the prompt, build, publish, test, push to GitHub.
3. **Verification (Claude):** clone the repo, run `npm ci`, `tsc`, `npm run build` and `npm test`, smoke-test the server, and check the acceptance list. Then this file is updated and the next prompt is sent.
4. **Parallel work:** while AI Studio builds a sprint, Claude builds self-contained, tested files for the next one. They are added at the exact paths given. AI Studio stays the only writer to the repo until hosting moves.

---

## Architecture (fixed rules)

- React + TypeScript + Vite frontend; Express + TypeScript backend in `/server`.
- `src/config/app.ts` is the only place the app name and tracked site are written.
- UI → hooks → adapter registry → adapters. Pages never import `/adapters/mock`.
- Each source has a mock and a live adapter. The registry switches per source based on connection state.
- All third-party API calls happen on the server. Tokens never reach the browser.
- Session: AES-256-GCM encrypted, httpOnly cookie `adlens_session`, with no database.
- **Report functions (from Sprint 6):** every report is a server-side function with a typed input schema, used by the API route now and by the AI analyst, custom agents and MCP endpoint later. Build each report once, never per consumer.
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

## Sprint 4 — Live Search Console data ⚠️

**Prompt sent:** 18 Oct 2026

**Status (18 Oct 2026):** built in AI Studio together with the Vercel-ready changes, but **not on GitHub**. GitHub `main` is at `618eadf`: two commits that uploaded the Meta mapper files directly on GitHub. Likely cause: AI Studio's push was blocked because GitHub had changes AI Studio didn't have. **Rule from now on: every file goes into the repo through AI Studio only.**

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

## Sprint 5 — Live Meta Ads data 🧩

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

## Sprint 6 — Traffic intelligence + AI referral traffic ⬜

Adopts #8–10 and #12.
- **Report-function layer:** refactor existing GA4/Search Console/Meta routes into typed report functions (see Architecture). This is the foundation for Sprints 10–12.
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

## Sprint 7 — Search intelligence ⬜

Adopts #6, #23, #24 and #27.
- **Trending queries:** rising, falling, new and lost versus the previous period, with minimum-volume thresholds and simple topic grouping.
- **SEO opportunities:** queries with 100+ impressions at average position 5–20 and CTR below half the typical CTR for that position, ranked by estimated extra clicks. Plus cannibalisation: 2+ pages each taking 10%+ of a query's impressions. The rules are shown in the UI.
- **Sitemaps:** read-only list of submitted sitemaps with errors, warnings and submitted counts.
- **Host breakdown:** per-hostname GA4 traffic, Search Console performance and sitemaps; flags hosts with traffic but no sitemap, or a sitemap but no traffic.
- **Prep done (18 Oct 2026):**
  - `server/lib/searchInsights.ts`: typical-CTR table, opportunities, cannibalisation, trending (new, lost, rising, falling) and topic grouping.
  - `server/lib/hostBreakdown.ts`: GA4 + Search Console + sitemaps per host, local/test hosts excluded, flags.
  - `server/lib/searchInsights.test.ts`: 7 tests.
  - Repo total with all prep files: 31/31 tests pass.

## Sprint 8 — Page detail + site snapshot ⬜

Adopts #11 and #14; absorbs the former "unified cross-channel overview".
- **Page detail:** click any page anywhere in AdLens to see:
  - views, sessions, users, engagement and key events;
  - channels, referrers (AI assistants marked), countries, devices and daily trend;
  - the Search Console queries it ranks for, with change versus the previous period.
- **Pages table** joining GA4 behaviour with Search Console clicks and position per URL.
- **Site snapshot** replaces the top of Overview. One screen with:
  - GA4 + Search Console + Meta totals with comparison;
  - top pages, top queries and channel mix;
  - rising, new and falling queries and pages (from Sprint 7).
- **Cross-channel:**
  - Meta campaigns matched to GA4 sessions via UTM campaign names, showing spend next to engaged sessions, key events and cost per engaged session.
  - Flags Meta campaigns with no matching UTM traffic.

## Sprint 9 — Flexible report builders ("Explore") ⬜

Adopts #19 and #26.
- **GA4 builder:**
  - dimension and metric catalogue loaded from the property, including custom definitions;
  - up to 9 dimensions and 10 metrics, validated with Google's compatibility check;
  - filters (exact, contains, regex, in-list, numeric, between, empty), sorting, comparison range, pagination.
- **Search Console builder:**
  - dimensions query, page, country, device, search appearance and date;
  - search types web, image, video, news, Discover and Google News;
  - final or fresh data, regex filters, pagination.
- Save report definitions, export CSV.
- These builders become the "anything else" tool for the AI analyst and MCP.

## Sprint 10 — Built-in AI analyst (Gemini) ⬜

- Gemini on the server with function calling over the report functions from Sprints 6–9.
- Chat UI on the AI Analyst page, with the date range and current page passed as context.
- Strategy: call the site snapshot first, then drill down (page detail, trending, builders).
- Needs a Gemini API key secret on Vercel.

## Sprint 11 — Database + bring-your-own AI agents ⬜

- **Database (required from here):**
  - Store Google and Meta refresh tokens server-side, encrypted, so agents and MCP clients can query without a browser session.
  - Store agent configs and saved reports.
  - Choice open: Neon Postgres or Upstash Redis via Vercel.
- **Agent registry:**
  - Supports Gemini, OpenAI-compatible endpoints and custom webhooks.
  - Each agent gets its own system prompt and data-source permissions.
  - All agents use the same report-function tools.

## Sprint 12 — MCP endpoint ⬜

Adopts #30.
- `/mcp` endpoint (Streamable HTTP, stateless, so it works on Vercel) exposing the report functions as MCP tools, read-only.
- **Phase A:** personal access keys generated in AdLens. These work with Claude Code, Cursor, Codex and Gemini CLI.
- **Phase B:** OAuth 2.1 (dynamic client registration, PKCE) for Claude.ai and ChatGPT connectors.
- Per-client access list and revoke under Connections; a tool guide served as an MCP resource.

## Sprint 13 — Reports, alerts, export, hardening ⬜

- Scheduled reports, anomaly alerts, and CSV/PDF export.
- Shared cache and rate limiting (Vercel); Google/Meta API request budget tracking.
- Code-splitting, error monitoring, and the final production deploy.

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

## Open decisions

- **Database (Sprint 11):** Neon Postgres or Upstash Redis.
- **MCP auth (Sprint 12):** confirm Phase A (access keys) first, Phase B (OAuth 2.1) after.

## Known issues and backlog

- **Weekly re-sign-in:** Google Testing mode expires sign-ins every 7 days. Permanent fix: move to Internal (needs a Synesis IT Workspace-owned project) or publish to Production.
- **Vercel memory:** the in-memory cache and rate limiter are per-instance on Vercel. A shared store comes in Sprint 9.
- **Preview deployments:** Vercel previews get different URLs, so only the production domain can do Google sign-in.
- **API quotas:** Sprints 6–9 add many more GA4/Search Console calls; caching and request budgets matter more (Sprint 13).
- **Bundle size:** the frontend bundle is about 735 KB. Code-splitting comes in Sprint 9.
- **Vercel plan:** check Vercel plan terms for company use (Hobby is non-commercial).
