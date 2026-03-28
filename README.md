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
|- package.json
|- wrangler.toml
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
- Local commits created and pushed
- Cloudflare Pages project `sheeper` created
- Local Cloudflare Pages dev smoke test passed for `/` and `/api/auth`
- Deployment still needs real project secrets before the hosted app can work end-to-end
- GitHub remote configured as `origin`
- Published to public GitHub repo `bdod-prod/sheeper`

## Publishing status

The canonical repo is now published on GitHub.

Remote:

- `bdod-prod/sheeper`

Branch status:

- local `main` tracks `origin/main`
- current published branch: `main`

## Cloudflare status

- Pages project: `sheeper`
- Default URL: `https://sheeper.pages.dev`
- Git integration: not connected yet
- Pages secrets configured: none yet
- Deployments created: none yet

## Local development

Repo-local Cloudflare workflow files:

- `wrangler.toml`
- `package.json`
- `.dev.vars.example`

Recommended commands:

```bash
npm run dev
```

On Windows PowerShell with script execution restricted, use:

```bash
npm.cmd run dev
```

For a fixed port:

```bash
npm.cmd run dev:8788
```

Local secrets belong in `.dev.vars` and should match `.dev.vars.example`.

## Next engineering tasks

1. Add real Pages secrets: `SHEEPER_TOKEN`, `GITHUB_TOKEN`, `CLAUDE_API_KEY`, and optional `OPENAI_API_KEY`.
2. Create the first deployment to `sheeper.pages.dev` once secrets exist.
3. Decide whether to keep Wrangler-based deploys or connect GitHub for dashboard-driven branch previews.
4. Add guardrails for large repos and oversized AI/file responses.
