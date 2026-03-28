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
- `XAI_API_KEY` (optional Grok backend)

Optional routing and model controls:

- `AI_PROVIDER=auto|claude|openai|grok`
- `AI_PROVIDER_PLAN=...`
- `AI_PROVIDER_STEP=...`
- `AI_PROVIDER_EDIT_SELECT=...`
- `AI_PROVIDER_EDIT=...`
- `CLAUDE_MODEL`
- `OPENAI_MODEL`
- `XAI_MODEL`

See `.dev.vars.example` for local naming.

## AI provider routing

Default behavior is unchanged:

- `auto` prefers Claude
- then falls back to OpenAI
- then falls back to Grok if `XAI_API_KEY` is configured

You can force a provider globally with `AI_PROVIDER`, or only for certain SHEEPER tasks:

- `AI_PROVIDER_PLAN`: branch planning during `/api/init`
- `AI_PROVIDER_STEP`: full build-step generation during `/api/step`
- `AI_PROVIDER_EDIT_SELECT`: cheap file-selection pass during `/api/edit`
- `AI_PROVIDER_EDIT`: full edit generation during `/api/edit`

Recommended first benchmark setup:

```bash
AI_PROVIDER=auto
AI_PROVIDER_PLAN=grok
AI_PROVIDER_EDIT_SELECT=grok
```

That keeps expensive file generation on the existing providers while testing Grok on lower-risk tasks first.

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

1. Add real Pages secrets: `SHEEPER_TOKEN`, `GITHUB_TOKEN`, `CLAUDE_API_KEY`, optional `OPENAI_API_KEY`, and optional `XAI_API_KEY`.
2. Run a Grok bakeoff on `plan`, `edit_select`, `step`, and `edit` tasks using the new routing flags.
3. Create the first deployment to `sheeper.pages.dev` once secrets exist.
4. Decide whether to keep Wrangler-based deploys or connect GitHub for dashboard-driven branch previews.
5. Add guardrails for large repos and oversized AI/file responses.
