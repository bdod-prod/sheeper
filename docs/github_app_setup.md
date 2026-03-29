# GitHub App Setup

SHEEPER now expects a real GitHub App for the post-preview ownership flow.

## Recommended GitHub App settings

- App type: GitHub App
- Webhooks: off for v1
- Expiring user tokens: on
- Setup URL: `https://<your-pages-host>/api/github/install/callback`
- Callback URL: `https://<your-pages-host>/api/github/connect/callback`
- Repository permissions:
  - `Contents`: Read and write
  - `Metadata`: Read-only
- Account scope for v1:
  - Personal account installs only

## Cloudflare env vars

Set these in Pages / local `.dev.vars`:

- `APP_BASE_URL`
- `APP_SESSION_SECRET`
- `GITHUB_APP_ID`
- `GITHUB_APP_CLIENT_ID`
- `GITHUB_APP_CLIENT_SECRET`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_SLUG`
- `GITHUB_TOKEN_ENCRYPTION_KEY`

## D1

Create a D1 database named `sheeper-app-db`, bind it as `APP_DB`, then apply:

```bash
npm.cmd run d1:apply
```

The schema file is:

- `db/app_schema.sql`

## Runtime behavior

- Users log into SHEEPER with the internal `SHEEPER_TOKEN`.
- GitHub is only requested when the user clicks `Save To GitHub`.
- If the user is connected but not installed, SHEEPER asks them to install the app on their personal account.
- After shipping, preview editing freezes and the user moves into the existing approve / discard branch flow.
