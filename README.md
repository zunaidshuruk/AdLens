# AdLens — Marketing Intelligence Console

AdLens unifies Google Analytics 4, Google Search Console, and Meta Ads telemetry for Convay (`convay.com`).

## Local Development

```bash
npm install
npm run dev
```

- `npm run dev` — Runs the Express backend (`API_PORT=3001`) and Vite frontend (`port 3000`) concurrently.
- `npm run build` — Builds the React SPA into `dist/` and bundles the Express server into `dist-server/index.js`.
- `npm start` — Starts the production Express server serving `dist/` and `/api/*`.
- `npm test` — Runs the test suite.

## Deploying to Vercel

AdLens includes a Vercel serverless entrypoint at `api/index.ts` and routing configuration in `vercel.json`.

### Required Environment Variables in Vercel

Configure the following environment variables in your Vercel Project Settings (**Settings → Environment Variables**):

- `GOOGLE_CLIENT_ID` — OAuth 2.0 Web Client ID from Google Cloud Console.
- `GOOGLE_CLIENT_SECRET` — OAuth 2.0 Web Client Secret from Google Cloud Console.
- `TOKEN_ENCRYPTION_KEY` — Secret string used to derive the AES-256-GCM key for encrypting the `adlens_session` cookie.
- `APP_BASE_URL` — Your production Vercel domain with **no trailing slash** (e.g., `https://adlens.vercel.app`).

### Google OAuth Redirect URI Format

In the Google Cloud Console (**APIs & Services → Credentials → OAuth 2.0 Client IDs**), add the following Authorized Redirect URI:

```text
{APP_BASE_URL}/api/auth/google/callback
```

For example, if `APP_BASE_URL` is `https://adlens.vercel.app`, the Authorized Redirect URI must be:

```text
https://adlens.vercel.app/api/auth/google/callback
```
