# AdLens — Launch checklist and submission pack (Sprint 10)

Run `npx tsx scripts/launch-readiness.ts` any time. It prints what still blocks launch (it never prints secret values).

## What the app already provides

| Needed by | Address (replace the host with your own domain) |
|---|---|
| Google (homepage) | `/welcome` |
| Google and Meta (privacy policy) | `/privacy` |
| Terms | `/terms` |
| Meta: data deletion instructions URL | `/data-deletion` |
| Meta: data deletion request callback URL | `POST /api/platform/meta/data-deletion` |
| Meta: deauthorize callback URL | `POST /api/platform/meta/deauthorize` |

The two callbacks verify Meta's signed request with `META_APP_SECRET` and answer with a confirmation code. The status page shows the result for that code.

## Settings to add (AI Studio secrets)

`SUPPORT_EMAIL` (required), `LEGAL_ENTITY` (default Synesis IT PLC), `LEGAL_ADDRESS` (recommended).

## Owner steps (cannot be done in code)

1. **Domain.** Pick and buy a domain, point it at the app, set `APP_BASE_URL` to it, add it to `AUTH_ALLOWED_HOSTS`, add it to Firebase Authentication → Authorized domains and to the Google OAuth client's authorised origins and redirect URIs. Verify the domain in Google Search Console.
2. **Read the legal pages.** The Privacy Policy and Terms describe what the product really does, but they are not legal advice. Have Synesis IT's counsel read them before you submit.
3. **Google OAuth verification** (Google Cloud Console → APIs & Services → OAuth consent screen):
   - Publishing status: move from Testing to In production, then submit for verification.
   - App homepage `/welcome`, privacy policy `/privacy`, terms `/terms`, authorised domain = your domain.
   - Scopes to justify (all read-only): Google Analytics (`analytics.readonly`) and Search Console (`webmasters.readonly`), plus basic profile and email for sign-in.
   - Justification text for each scope: "AdLens shows the signed-in user their own Google Analytics reports and answers their questions about them. Access is read-only and is used only for that purpose."
   - Demo video (YouTube, unlisted), about 3–4 minutes: show the sign-in with the OAuth consent screen and the app name; show Connections → Connect Google; show a GA4 report and a Search Console report appearing; show Disconnect. Show the browser address bar with your domain throughout.
4. **Meta Business Verification** of Synesis IT PLC (Meta Business Settings → Security Center). Have the company registration documents ready.
5. **Meta App Review** for `ads_read` Advanced Access:
   - App settings: privacy policy URL, data deletion callback URL (above), app icon, category.
   - Screencast (about 2 minutes): Connect Facebook → choose an ad account → open Meta Ads and Ads vs website visits. Say what the data is used for.
   - Test credentials: create a test user with access to a test ad account, and write the steps for the reviewer.
6. **Private beta until approval.** Google allows up to 100 test users in Testing mode; Meta allows only people with an app role. Add testers there.
7. **Republish `firebase/firestore.rules`** after a green Actions run (already pending from an earlier sprint).

## Known limits

- Facebook connections made before 26 Oct 2026 are not linked to a Facebook user id, so Meta's deletion callback cannot find them. They are linked automatically the next time the person reconnects Facebook. Disconnecting in AdLens always works.
- The landing page has no screenshots yet. Add them once the design is final.
