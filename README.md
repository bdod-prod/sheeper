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
|     |- _brief.js
|     |- _shared.js
|     |- auth.js
|     |- intake.js
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

SHEEPER is a conversational interface for building and editing static websites.

- `index.html` and `app.js` provide the operator UI.
- `functions/api/intake.js` handles the conversational intake loop.
- `functions/api/init.js` turns the confirmed brief into a branch, `_sheeper/` state, and a build plan.
- Build sessions store both the canonical brief and intake transcript inside the target site's `_sheeper/` folder on staging branches.

## Expected environment variables

- `SHEEPER_TOKEN`
- `GITHUB_TOKEN`
- `CLAUDE_API_KEY`
- `OPENAI_API_KEY` (optional fallback)
- `XAI_API_KEY` (optional Grok backend)

Optional routing and model controls:

- `AI_PROVIDER=auto|claude|openai|grok`
- `AI_PROVIDER_INTAKE_CHAT=...`
- `AI_PROVIDER_BRIEF_COMPILE=...`
- `AI_PROVIDER_PLAN=...`
- `AI_PROVIDER_STEP=...`
- `AI_PROVIDER_EDIT_SELECT=...`
- `AI_PROVIDER_EDIT=...`
- `CLAUDE_MODEL`
- `OPENAI_MODEL`
- `XAI_MODEL`

See `.dev.vars.example` for local naming.

## AI provider routing

SHEEPER now separates intake, synthesis, and implementation lanes:

- `AI_PROVIDER_INTAKE_CHAT`: conversational intake triage during `/api/intake`
- `AI_PROVIDER_BRIEF_COMPILE`: canonical brief compilation during `/api/intake`
- `AI_PROVIDER_PLAN`: build planning during `/api/init`
- `AI_PROVIDER_STEP`: full build-step generation during `/api/step`
- `AI_PROVIDER_EDIT_SELECT`: file-selection pass during `/api/edit`
- `AI_PROVIDER_EDIT`: full edit generation during `/api/edit`

When `AI_PROVIDER=auto`, the built-in alpha defaults prefer:

- fast lane for `intake_chat` and `edit_select`
- highest-quality lane for `brief_compile`, `plan`, `step`, and `edit`

You can still force a provider globally with `AI_PROVIDER`, or override individual tasks with the task-specific variables above.

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
- Conversational intake is now the primary project-start path
- `_sheeper/intake.json` persists the intake transcript and compiled-brief provenance once build starts
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
- Pages secrets and deployments should be checked in Cloudflare before relying on the hosted app for live tests

## Local development

Repo-local Cloudflare workflow files:

- `wrangler.toml`
- `package.json`
- `.dev.vars.example`
- `scripts/push-pages-secrets.mjs`

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

To upload non-empty secrets from local `.dev.vars` to Cloudflare Pages:

```bash
npm.cmd run secrets:push
```

To upload only selected keys:

```bash
npm.cmd run secrets:push -- --only GITHUB_TOKEN,OPENAI_API_KEY
```

## Next engineering tasks

1. Add real Pages secrets: `SHEEPER_TOKEN`, `GITHUB_TOKEN`, `CLAUDE_API_KEY`, optional `OPENAI_API_KEY`, and optional `XAI_API_KEY`.
2. Run a Grok bakeoff on `plan`, `edit_select`, `step`, and `edit` tasks using the new routing flags.
3. Create the first deployment to `sheeper.pages.dev` once secrets exist.
4. Decide whether to keep Wrangler-based deploys or connect GitHub for dashboard-driven branch previews.
5. Add guardrails for large repos and oversized AI/file responses.
