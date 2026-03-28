# SHEEPER Cloudflare Pages Repo

Canonical working repo for the current SHEEPER implementation.

This repo was normalized from the flat export in `../sheeper_flat_export` so future work can happen in a conventional Cloudflare Pages structure.

## Structure

```text
sheeper_cloudflare_pages_repo/
|- index.html
|- app.js
|- functions/
|  `- api/
|     |- _shared.js
|     |- auth.js
|     |- init.js
|     |- status.js
|     |- step.js
|     |- edit.js
|     |- approve.js
|     `- reject.js
|- .dev.vars.example
`- .gitignore
```

## What this app does

SHEEPER is a natural-language interface for building and editing static websites.

- `index.html` and `app.js` provide the UI.
- `functions/api/*` implements Cloudflare Pages Functions endpoints.
- Build sessions store state inside the target site's `_sheeper/` folder on staging branches.

## Expected environment variables

- `SHEEPER_TOKEN`
- `GITHUB_TOKEN`
- `CLAUDE_API_KEY`
- `OPENAI_API_KEY` (optional fallback)

See `.dev.vars.example` for local naming.

## Deployment assumption

This layout targets **Cloudflare Pages + Pages Functions**:

- static files at repo root
- API handlers in `functions/api/*.js`
- frontend calling same-origin `/api/*`

## Current status

- Layout normalized
- Original flat export preserved separately
- Local git repo initialized on `main`
- No commit yet because git identity is not configured on this machine
- Deployment still needs a real environment validation pass with credentials

## Next engineering tasks

1. Run a real local/dev deploy check with configured env vars.
2. Confirm preview URL behavior against actual Cloudflare Pages project naming.
3. Add guardrails for large repos and oversized AI/file responses.
