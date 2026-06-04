# Handoff — LinkedIn Lead Magnet Emailing Automation

## Source of truth

`impl-plan.md` holds the full 12-stage plan (Stage 0–11). This handoff tracks
**progress + findings**; the plan holds the spec. Read the plan for any stage detail.

## Response style

User wants terse "caveman" replies in chat until they say `stop caveman` / `normal mode`.
Does NOT affect doc/code style — only chat prose.

## Status

- ✅ Stage 0 — Dependencies & workspace prep
- ✅ Stage 1 — DB schema & migration
- ✅ Stage 2 — Lead magnet library (typed data)
- ✅ Stage 3 — Pure helpers (`url.ts`, `names.ts`, `emails.ts`)
- ✅ Stage 4 — Integration helpers (`lead-magnet-selection.ts`, `google-sheets.ts`)
- ✅ Stage 5 — Background schemas & types (`types.ts`)
- ✅ Stage 6 — Internal API callback endpoints (`routers/internal.ts`)
- ⏳ Stage 7 — Trigger tasks (`scrape-post`, `email-generation`) — NEXT
- ⬜ Stage 8–11 — pending (see plan)

## Decision changes since the plan was first written

- **No automated tests, anywhere.** Verification = `bun run check-types` +
  `bun x ultracite check` + manual smoke. A unit test that was written for the lead
  magnet library was **removed** at user request, and the `**/*.test.ts` exclude added
  to `packages/background/tsconfig.json` was **reverted**. Keep helpers pure and the
  Apify parser isolated for reviewability, but do **not** add `*.test.ts` files. This
  decision is recorded in `impl-plan.md` Core decisions and all stage checkpoints were
  rewritten to compile/type-check based.

- **Claude authors the email template; we store it on D1 (per-post).** Big
  architecture change after Stages 1–6 were first built. Previously: Claude only
  picked 3 magnet ids and email copy was hardcoded in `emails.ts`. Now: in the
  `scrape-post` task Claude **selects 3 real magnets AND writes the 3-email template**
  from the post; the template (6 fields: subject+body × email1/followUp1/followUp2,
  `${firstName}` the only placeholder) is stored on the `auto_emailing` row.
  Email-gen just substitutes `${firstName}`. Stages 1, 3, 4, 5, 6 were **reworked**
  to this design (notes below reflect the new state). `impl-plan.md` updated to match.

## What is implemented

### Stage 0

- Added to `packages/background/package.json` deps: `ai@6.0.194`,
  `@ai-sdk/anthropic@3.0.81`, `apify-client@2.23.3`, `googleapis@173.0.0`.
- `bun install` clean. AI SDK is **v6**.

### Stage 1

- `packages/db/src/schema/auto-emailing.ts` — Drizzle SQLite table `auto_emailing`
  (snake_case cols), unique `original_post_url`, `scraped` boolean default false,
  `created_at`/`updated_at` text default `(current_timestamp)`. Exports
  `AutoEmailing` / `NewAutoEmailing` inferred types.
- Exported via `packages/db/src/schema/index.ts` (`export * from "./auto-emailing"`).
- Migration generated: `packages/db/src/migrations/0000_cool_spyke.sql`
  (CREATE TABLE + unique index). Hash `5a43a5f8…`.
- **Migration `0001_faulty_darwin.sql`** adds the 6 template columns
  (`email1_subject`, `email1_body`, `follow_up_1_subject`, `follow_up_1_body`,
  `follow_up_2_subject`, `follow_up_2_body`) as nullable text — forward-only
  ALTERs (0000 already applied locally; remote still empty). Schema keeps the 3
  magnet id cols too.

### Stage 2

- `packages/background/src/lead-magnets.ts` — 38 lead magnets across 7 categories,
  extracted from `/Users/a3tech/Downloads/linkedin-lead-magnet-SKILL.md.pdf`.
  - `LeadMagnet` interface; `LEAD_MAGNETS` is `as const satisfies readonly LeadMagnet[]`;
    `LeadMagnetId` union derived from it.
  - Helpers: `getLeadMagnetById(id)`, `leadMagnetExists(id)`,
    `resolveLeadMagnetSequence({ targetedLeadMagnetId, followUpOneLeadMagnetId,
    followUpTwoLeadMagnetId })` (throws on unknown or non-distinct ids).
  - `painLine` completes the sentence "so you don't ___" (matches email templates).
  - IDs are stable lowercase kebab-case; AI selection must only return these ids.

### Stage 3

- `packages/background/src/url.ts` — `normalizePostUrl(url)`. Lower-cases
  scheme+host, drops leading `www.`, strips query/fragment/trailing slash. Path
  kept verbatim (activity slugs are case-sensitive). Invalid URL → trimmed,
  lower-cased, de-slashed fallback. Pure. Module-level regex consts.
- `packages/background/src/names.ts` — `getFirstName(fullName)`. First
  whitespace token, strips leading non-letters (Unicode `\p{L}`). Exports
  `DEFAULT_FIRST_NAME = "there"` fallback so greetings never render "Hey ,".
  Pure.
- `packages/background/src/emails.ts` — `applyLeadVariables(template, { firstName })`
  → replaces `${firstName}` in each subject/body of the stored template. Exports
  `Email`, `EmailSequence`, `LeadVariables`, and `FIRST_NAME_PLACEHOLDER` (the
  literal `${firstName}`, built as `` `\${${FIRST_NAME_KEY}}` `` to dodge biome
  `noTemplateCurlyInString`). Pure. The old `renderEmailSequence` (code-side copy
  from magnet fields) was **removed** — copy is now AI-authored + DB-stored.

### Stage 4

- `packages/background/src/lead-magnet-selection.ts` —
  `generatePostEmailSequence({ postContent, posterName? })`. AI SDK **v6**:
  `generateText` + `output: Output.object({ schema })` (NOT `generateObject`);
  result read from `output`. Provider **Anthropic** (`@ai-sdk/anthropic`, reads
  `ANTHROPIC_API_KEY`), model `claude-sonnet-4-5`. Claude **both** picks 3 magnet
  ids **and writes** the 3-email template (9-field schema: 3 ids + 6 template
  fields + `reason`). Validation: `resolveLeadMagnetSequence` (ids exist+distinct),
  every template field non-empty, each body contains `${firstName}`. Throws on
  blank `postContent`. Returns `GeneratedPostSequence` = 3 ids + `template:
  EmailSequence` + `reason`. System prompt embeds the authoring guide + catalog;
  `${firstName}` passed via the imported `FIRST_NAME_PLACEHOLDER`.
- `packages/background/src/google-sheets.ts` — `appendEmailRows(rows)` →
  `{ sheetUrl, rowsWritten }`. `googleapis` service-account auth
  (`GOOGLE_SERVICE_ACCOUNT_JSON`), `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB`
  (default `Sheet1`). `values.append`, `valueInputOption: "RAW"`, range
  `${tab}!A1`. `EmailSheetRow` interface (alphabetical members);
  `SHEET_COLUMNS` const = single source of truth for the 28-col Instantly order
  (Stage 10). Empty `rows` → 0 written, no API call. `requireEnv` throws on
  missing env. Reads `process.env` (tasks run on Trigger/Node, not the Worker).

### Stage 5

- `packages/background/src/types.ts` — added zod schemas + inferred types:
  `startLinkedinScrapingPayloadSchema`, `scrapePostPayloadSchema`,
  `clayLeadSchema` (12 required fields incl. `email`; `originalPostUrl` `.min(1)`),
  `emailGenerationPayloadSchema` (`leads` `.array().min(1)`). All ids/types use
  `z.infer`.
- Also added the **internal-endpoint contract** schemas here (NOT in the API
  package) so the Stage 7 task and the Stage 6 endpoint share them without a
  cycle (api → background only): `postCacheUpdatePayloadSchema`
  (`posterName` `.nullish()`, 3 magnet ids, **+ 6 template fields** `.min(1)`),
  `postCacheBatchGetPayloadSchema`, `postCacheRowSchema` (+ `PostCacheRow`, incl.
  the 6 template fields, nullable). Imported via
  `@sr-custom-emailing/background/types`.

### Stage 6

- `packages/api/src/routers/internal.ts` — new `internalRouter`, registered in
  `routers/index.ts` under key `internal`. Two REST procedures:
  `POST /automation/internal/post-cache/update` and
  `POST /automation/internal/post-cache/batch-get`.
- **Effective URL has the OpenAPI prefix.** `apps/server` mounts the
  `OpenAPIHandler` with `prefix: "/api-reference"`, so the task must call
  `${INTERNAL_API_URL}/api-reference/automation/internal/post-cache/update`
  (same prefix the existing `startBackgroundProcessing` REST route uses). Did
  NOT change the server prefix (out of scope, would move existing routes).
- Auth: `internalProcedure` now lives in `packages/api/src/auth.ts` (moved out of
  `internal.ts` so it can be shared) and middleware checks the `x-internal-secret`
  header against `env.INTERNAL_API_SECRET`. **Fails closed** (secret unset →
  reject all). Constant-time compare via addition (biome bans bitwise ops —
  `noBitwiseOperators` — and biome-ignore is forbidden). Rejects with
  `ORPCError("UNAUTHORIZED")` → 401.
- **Public automation endpoints are now guarded too.** `startLinkedinScraping`
  (`POST /automation/linkedin-scraping`, triggers the Claude scrape task) and
  `startEmailGeneration` (`POST /automation/email-generation`) use
  `internalProcedure` in `routers/automation.ts`. Callers (Clay, the scraping
  trigger) MUST send `x-internal-secret: <INTERNAL_API_SECRET>` or get 401.
- `context.ts` extended to expose `headers: c.req.raw.headers` (additive) so the
  middleware can read the header.
- Drizzle stays **inside the db package** (api does not depend on `drizzle-orm`).
  Added `upsertScrapedPost(input)` (insert + `onConflictDoUpdate` on
  `original_post_url`, writes 3 magnet ids **+ 6 template fields**, `scraped=true`,
  bumps `updatedAt`) and `getPostsByUrls(urls)` (`inArray`, empty → `[]`,
  `select()` returns the template cols) to `packages/db/src/index.ts`. The router
  normalizes URLs (`normalizePostUrl`) before calling and `batch-get` returns the
  6 template fields.
- `packages/infra/alchemy.run.ts` — added `INTERNAL_API_SECRET` Worker binding
  (`alchemy.env.INTERNAL_API_SECRET ?? ""`); it flows into `server.Env` so
  `env.INTERNAL_API_SECRET` is typed. Supply a real value in
  `packages/infra/.env` before deploy.

## Project rules that bit us (obey them)

- **`ts-set-map` rule:** static string-keyed lookup tables must be `Record`, not `Map`.
  The id lookup table was switched to `Record<string, LeadMagnet>`. BUT bracket access
  on a plain object hits `Object.prototype` (`obj["toString"]` returns a function), so
  `getLeadMagnetById` guards with `Object.hasOwn(...)`. Runtime dedup checks may still
  use `new Set(...)` (legit dynamic use) — that's what `resolveLeadMagnetSequence` does.
- Ultracite/Biome enforces sorted interface members, top-level regex literals, and
  formatting. Run `bun x ultracite fix` then resolve the non-fixable ones (e.g. hoist
  regex to a module-level const).

## DB / deployment findings (important)

The DB is wired through **Alchemy**, not drizzle-kit. Key facts:

- `drizzle.config.ts` uses `dialect: "sqlite"`, `driver: "d1-http"`, but has **no
  `dbCredentials`** → `bun run db:push` fails with
  `Please provide required params for D1 HTTP driver: accountId / databaseId / token`.
  Do not rely on `db:push`. Migrations are applied by Alchemy's `migrationsDir`.
- Remote Cloudflare D1 **already exists** (confirmed via `wrangler d1 list`):
  - name `sr-custom-emailing-database-a3tech`
  - uuid `c15c29fa-9c07-41e3-a733-5fe8508009a6`
  - `num_tables: 0` (empty — no migrations applied remotely yet)
- Local Alchemy state (`packages/infra/.alchemy/.../database.json`) had `output.id: ""`
  and `dev.remote: false` → it did **not** know the remote DB. A local miniflare D1
  sqlite exists under `.alchemy/miniflare/...` and already has `0000_cool_spyke.sql`
  applied (dev runs).
- **Fix applied:** added `adopt: true` to the `D1Database("database", …)` resource in
  `packages/infra/alchemy.run.ts`. Verified `adopt?: boolean` is a real prop in
  `alchemy@0.91.2` (catches "already exists", finds DB by name, adopts).

### How to apply the migration to remote D1

```bash
bun run deploy
```

This adopts the existing remote D1, runs pending migration files (creates
`auto_emailing` + `d1_migrations` since it's empty), and deploys the Worker.

- Auth: user is logged into `wrangler` (d1 list worked); Alchemy usually reuses that.
  If deploy errors on auth, add `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`) to
  `packages/infra/.env`.
- **Deploy applies migration FILES forward-only — it is not a schema diff.** Future
  schema changes: `bun run db:generate` (new migration) → `bun run deploy`.

## Env state (no secrets invented; supply real values before runtime/smoke)

`packages/infra/.env` (Trigger/Worker-side secrets live here locally):
- `ALCHEMY_PASSWORD` set (state encryption)
- `APIFY_API_KEY=123` (PLACEHOLDER → real)
- `ANTHROPIC_API_KEY=123` (PLACEHOLDER → real, if Anthropic path)
- `CLAY_API_KEY`, `INSTANTLY_API_KEY` set (placeholders)
- `TRIGGER_PROJECT_REF`, `TRIGGER_SECRET_KEY` set

`apps/server/.env`:
- `CORS_ORIGIN=http://localhost:3001` only

**Missing, needed before runtime/smoke:**
- `GOOGLE_SERVICE_ACCOUNT_JSON` + `GOOGLE_SHEET_ID` (share the Sheet with the service
  account email, else 403 on write). Optional `GOOGLE_SHEET_TAB` (default `Sheet1`).
- `INTERNAL_API_SECRET` (shared: Worker binding + Trigger task) and `INTERNAL_API_URL`
  (deployed Worker URL for task → API callback). Stage 6 adds the binding to
  `alchemy.run.ts`.
- For remote deploy auth (if Alchemy can't reuse wrangler login): `CLOUDFLARE_API_TOKEN`
  (+ `CLOUDFLARE_ACCOUNT_ID`).

**Trigger.dev note:** task code runs on Trigger.dev, not the Worker. Task-side secrets
(`APIFY_API_KEY`, AI key, `GOOGLE_*`, `INTERNAL_*`) must be set in the Trigger.dev
project env (dashboard / `trigger.dev` env sync), not only local `.env`.

## Resolved decision (Stage 4)

AI provider for `selectLeadMagnetSequence`: **Anthropic** chosen (default; the
`ANTHROPIC_API_KEY` slot already exists, read automatically by
`@ai-sdk/anthropic`). Model const `claude-sonnet-4-5` in
`lead-magnet-selection.ts` — change there if a different model is wanted.
Gateway/OIDC was not used.

## Verification commands

```bash
bun run check-types     # all packages, currently green
bun x ultracite check   # lint/format, currently green on touched files
```

## Next action

Start **Stage 7 — Trigger tasks** under `packages/background/src/trigger/`
(export from `trigger/index.ts`):
- `scrape-post.task.ts` (id `scrape-post`, schema `scrapePostPayloadSchema`):
  Apify scrape → isolated pure parser probing `text`/`content`/`postText`/
  `commentary`/`description` (fail loudly on empty) → `generatePostEmailSequence`
  ({ postContent, posterName }) which selects magnets + authors the template →
  POST internal `post-cache/update` with the 3 ids + 6 template fields (send
  `x-internal-secret`, use the `/api-reference` prefixed URL).
- `email-generation.task.ts` (id `email-generation`, schema
  `emailGenerationPayloadSchema`): normalize + group by `originalPostUrl` →
  POST internal `post-cache/batch-get` → fail with exact URL list if any
  missing/`scraped=false` or template fields null → per lead: `getFirstName` +
  `applyLeadVariables(storedTemplate, { firstName })` (no model call); resolve
  the stored magnet ids via `getLeadMagnetById` for the Sheet magnet
  name/description/painLine cols → build `EmailSheetRow[]` (Stage 10 cols) →
  `appendEmailRows`.
Task-side env (Trigger.dev project env): `APIFY_API_KEY`, `ANTHROPIC_API_KEY`,
`GOOGLE_*`, `INTERNAL_API_URL`, `INTERNAL_API_SECRET`. See `impl-plan.md`
Stage 7. No test files.