# SHEEPER Cloudflare Pages Repo

Canonical working repo for the current SHEEPER implementation.

This repo was normalized from the flat export in `../sheeper_flat_export` and now implements a **preview-first internal alpha**: users describe a site, SHEEPER builds into a protected 24-hour preview session, and GitHub only enters the flow when they decide to save the result.

## Structure

```text
sheeper_cloudflare_pages_repo/
|- index.html
|- app.js
|- functions/
|  |- api/
|  |  |- _brief.js
|  |  |- _generation.js
|  |  |- _github_app.js
|  |  |- _plan.js
|  |  |- _appdb.js
|  |  |- _preview.js
|  |  |- _shared.js
|  |  |- auth.js
|  |  |- intake.js
|  |  |- init.js
|  |  |- status.js
|  |  |- step.js
|  |  |- edit.js
|  |  |- approve.js
|  |  |- reject.js
|  |  |- github/
|  |  |  |- connect/
|  |  |  |  |- start.js
|  |  |  |  |- callback.js
|  |  |  |  |- status.js
|  |  |  |  `- disconnect.js
|  |  |  |- install/
|  |  |  |  |- start.js
|  |  |  |  `- callback.js
|  |  |  |- repos/
|  |  |  |  `- create.js
|  |  |  `- repos.js
|  |  |- preview/
|  |  |  |- start.js
|  |  |  |- status.js
|  |  |  |- step.js
|  |  |  `- edit.js
|  |  `- ship/
|  |     `- github.js
|  `- preview/
|     `- [[path]].js
|- db/
|  `- app_schema.sql
|- preview-session-worker/
|  |- src/index.mjs
|  `- wrangler.toml
|- scripts/
|  `- push-pages-secrets.mjs
|- package.json
|- wrangler.toml
|- .dev.vars.example
`- .gitignore
```

## What this app does

SHEEPER is a conversational static-site builder with two distinct phases:

1. **Preview phase**
- `functions/api/intake.js` compiles the brief from conversation plus optional source material.
- `functions/api/preview/start.js` creates a protected preview session.
- `functions/api/preview/step.js` and `functions/api/preview/edit.js` generate files into temporary session storage.
- `functions/preview/[[path]].js` serves the protected live preview.

2. **Ownership phase**
- `functions/api/github/*` manages GitHub App connect, install, repo listing, and repo creation.
- `functions/api/ship/github.js` saves the current preview state to a connected user's repo on a SHEEPER staging branch.
- `functions/api/approve.js` and `functions/api/reject.js` reuse the existing branch merge/discard flow after shipping, but now respect the shipping connection.

## Preview-first architecture

Preview sessions are independent of the user's repo.

- Session metadata lives in the `PreviewSessionDO` Durable Object worker.
- Generated files and uploaded assets live in the `PREVIEW_ASSETS` R2 bucket.
- Preview URLs are protected with a session-scoped cookie and are intended for the same browser session only.
- Session TTL is 24 hours.
- GitHub becomes optional until the user clicks **Save To GitHub**.
- GitHub is now designed around a per-user GitHub App connection instead of a single hidden server token.

## Logging and observability

SHEEPER now keeps two kinds of logs during preview-first builds:

- **Persistent session events** inside `session.log.events`
  - preview started
  - plan generated
  - step/edit started and completed
  - GitHub ship, approve, and discard actions
  - AI JSON parse status, including repair attempts when needed
- **Cloudflare runtime logs** for the preview-session worker
  - worker observability is enabled in `preview-session-worker/wrangler.toml`
  - this is for debugging and postmortems, while `session.log.events` is the builder-facing history

The left-hand build log in the UI is now driven by persisted session events whenever they are available, so reopening a preview session restores its meaningful history instead of only transient browser messages.

## Expected environment variables

Required for app auth and AI:

- `SHEEPER_TOKEN`
- `CLAUDE_API_KEY`

Required for GitHub App shipping:

- `APP_BASE_URL`
- `APP_SESSION_SECRET`
- `GITHUB_APP_ID`
- `GITHUB_APP_CLIENT_ID`
- `GITHUB_APP_CLIENT_SECRET`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_SLUG`
- `GITHUB_TOKEN_ENCRYPTION_KEY`

Optional:

- `OPENAI_API_KEY`
- `XAI_API_KEY`
- `GITHUB_TOKEN`
- `ALLOW_SHARED_GITHUB_TOKEN_FALLBACK=false`

Optional routing and model controls:

- `AI_PROVIDER=auto|claude|openai|grok`
- `AI_PROVIDER_INTAKE_CHAT=...`
- `AI_PROVIDER_BRIEF_COMPILE=...`
- `AI_PROVIDER_PLAN=...`
- `AI_PROVIDER_STEP=...`
- `AI_PROVIDER_EDIT_SELECT=...`
- `AI_PROVIDER_EDIT=...`
- `AI_PROVIDER_JSON_REPAIR=...`
- `CLAUDE_MODEL`
- `OPENAI_MODEL`
- `XAI_MODEL`

See `.dev.vars.example` for local naming.

## AI provider routing

SHEEPER separates conversation, synthesis, and implementation lanes:

- `AI_PROVIDER_INTAKE_CHAT`: conversational intake triage during `/api/intake`
- `AI_PROVIDER_BRIEF_COMPILE`: canonical brief compilation during `/api/intake`
- `AI_PROVIDER_PLAN`: build planning during `/api/init` and `/api/preview/start`
- `AI_PROVIDER_STEP`: build-step generation during `/api/step` and `/api/preview/step`
- `AI_PROVIDER_EDIT_SELECT`: file-selection pass during `/api/edit` and `/api/preview/edit`
- `AI_PROVIDER_EDIT`: full edit generation during `/api/edit` and `/api/preview/edit`
- `AI_PROVIDER_JSON_REPAIR`: fallback JSON repair when a model returns malformed structured output

When `AI_PROVIDER=auto`, the internal-alpha defaults prefer:

- fast lane for `intake_chat` and `edit_select`
- highest-quality lane for `brief_compile`, `plan`, `step`, and `edit`

## Cloudflare bindings and deployment order

The Pages app now expects these bindings from `wrangler.toml`:

- `PREVIEW_ASSETS` -> R2 bucket `sheeper-preview-assets`
- `PREVIEW_SESSIONS` -> Durable Object class `PreviewSessionDO` from worker script `sheeper-preview-session`
- `APP_DB` -> D1 database for browser sessions, GitHub connections, and OAuth state

Recommended order:

1. Create the R2 bucket `sheeper-preview-assets` if it does not exist.
2. Create the D1 database `sheeper-app-db`, then apply `db/app_schema.sql`.
3. Bind that D1 database as `APP_DB` in the Pages project.
4. Deploy the preview worker:
   - `npm.cmd run deploy:preview-worker`
5. Configure the GitHub App secrets in Pages / `.dev.vars`.
6. Deploy the Pages app:
   - `npm.cmd run deploy:main`

Note: this repo includes the D1 schema and code paths, but the live D1 binding still has to be provisioned in Cloudflare before the GitHub App flow can work in a deployed environment.

## Local development

Local secrets belong in `.dev.vars` and should match `.dev.vars.example`.

Pages app:

```bash
npm.cmd run dev
```

Preview session worker in a second terminal:

```bash
npm.cmd run dev:preview-worker
```

To upload non-empty secrets from local `.dev.vars` to Cloudflare Pages:

```bash
npm.cmd run secrets:push
```

To upload only selected keys:

```bash
npm.cmd run secrets:push -- --only GITHUB_TOKEN,OPENAI_API_KEY
```

## Current status

- Preview-first conversational intake is implemented.
- Source-material intake supports URL, pasted text, and uploaded text-friendly files.
- Protected 24-hour preview sessions are implemented via Durable Object + R2.
- GitHub save happens after preview on a SHEEPER staging branch.
- Per-user GitHub App connect flow is implemented in code, with repo creation and searchable existing-repo selection.
- Repo-backed endpoints still exist as a migration fallback.
- Canonical repo is published at `bdod-prod/sheeper`.

## Next engineering tasks

1. Provision the D1 binding and GitHub App secrets in Cloudflare Pages.
2. Run the first full browser-based alpha flow through Connect GitHub -> Create new repo -> Save preview.
3. Verify existing-repo picker behavior against an installation scoped to only selected repositories.
4. Decide whether to add download/export before asking for GitHub.
5. Add guardrails for large repos and oversized AI/file responses.
