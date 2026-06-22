# sr-custom-emailing

LinkedIn outreach automation. Two pipelines that share scraping, a D1 cache, and
AI copy authoring, but differ in copy style and destination:

- **`ourLinkedinCommentTracking`** — people who comment on **our** LinkedIn posts
  get short **LinkedIn DMs**, written one row per commenter to a **Google Sheet**.
- **`someoneElsePostScraping`** — leads from **someone else's** post get cold
  **emails** pushed into an **Instantly** campaign.

Full behaviour spec: [`impl-plan.md`](./impl-plan.md). Runtime runbook:
[`project_testing.md`](./project_testing.md). Progress + decisions:
[`handoff.md`](./handoff.md).

Built on [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack):
Hono + oRPC on Cloudflare Workers, Drizzle on D1, Trigger.dev for background work,
Alchemy for infra, Biome/Ultracite for quality.

## Architecture

```
                       ┌──────────────────────── apps/server (Hono) ───────────────────────┐
client / Clay ──HTTP──▶│  /rpc (RPC)   ·   /api-reference (OpenAPI)   ·   CORS · evlog       │
                       └───────────────────────────────┬───────────────────────────────────┘
                                                        │ packages/api (oRPC routers + auth)
                          ┌─────────────────────────────┼─────────────────────────────┐
                          │ public flow endpoints        │ internal cache endpoints     │
                          │ (internalProcedure-guarded)  │ (x-internal-secret)          │
                          ▼                              ▼                              │
                 D1 cache check + enqueue        read/write auto_emailing (packages/db) │
                          │                                                              ▲
                          ▼ Trigger.dev tasks (packages/background)                      │
        scrape: Apify ─▶ Claude (magnets + copy) ─▶ POST /internal/post-cache/update ───┘
      generate: group leads ─▶ POST /internal/post-cache/batch-get ─▶ Google Sheet | Instantly
```

**Separation of concerns**

- **`apps/server`** — HTTP edge only. Mounts the oRPC RPC handler at `/rpc` and
  the OpenAPI handler at `/api-reference`; wires CORS + logging. No business logic.
- **`packages/api`** — oRPC routers and the `internalProcedure` auth guard. The
  request path **never** scrapes or calls the AI; it only checks the D1 cache and
  enqueues Trigger tasks. Two public routers (one per flow) + one internal router
  (the task→D1 callback contract). Depends on `background` + `db`.
- **`packages/background`** — all heavy/external work, run **only** inside
  Trigger.dev tasks: Apify post + commenter scraping, Anthropic copy authoring,
  Google Sheets, Instantly, Clay forwarding. Tasks have no Worker D1 binding, so
  they reach D1 exclusively through the protected internal API
  (`internal-api.ts`). Holds the pure helpers (`url`, `names`, `emails`), the
  lead-magnet catalog, the shared zod schemas/types, and the `triggerXxx`
  wrappers.
- **`packages/db`** — the **only** package that imports `drizzle-orm`. Owns the
  `auto_emailing` schema, the typed queries, and the D1 migrations.
- **`packages/env`** — typed Cloudflare Worker env bindings.
- **`packages/infra`** — Alchemy IaC: the Worker + D1 resource and their bindings.
- **`packages/config`** — shared `tsconfig` base.

**Two flows, one cache.** `auto_emailing` is unique on `original_post_url` and
carries a `source` discriminator (`comment_tracking` | `someone_else`) that
selects which copy columns are authoritative (2 DM bodies vs. 6 email fields).
Scraping, magnet selection, and the cache are shared; only authoring style and
the generate-step sink differ. See `impl-plan.md` for the field-level contract.

**Commenter harvest.** Each scrape command also kicks off `harvest-commenters`:
an **async** Apify run of `harvestapi/linkedin-post-comments` whose completion
webhook hits `POST /apify/commenters/{flow}` (shared-secret guarded). That route
enqueues `forward-commenters-to-clay`, which fetches the dataset and POSTs the
commenters to the Clay enricher table (`CLAY_ENRICHER_TABLE_URL`, auth via
`CLAY_ENRICHER_AUTH_TOKEN`) tagged with `flow`. Clay enriches and posts each
lead back to the matching `{flow}` generate endpoint, so `flow` threads the whole
Apify → webhook → Clay → generate round trip.

## Getting Started

```bash
bun install
bun run dev    # Alchemy dev Worker + `trigger dev` tasks
```

The dev Worker listens on [http://localhost:3000](http://localhost:3000). Set the
secrets listed in `project_testing.md` Phase 1 before exercising any flow.

## Database (Cloudflare D1 via Alchemy)

D1 is provisioned and migrated through **Alchemy**, not drizzle-kit.

- Generate a migration after a schema change: `bun run db:generate`.
- Apply migrations + deploy: `bun run deploy` (adopts the existing remote D1 and
  applies pending migration **files** forward-only — it is not a schema diff).
- `bun run dev` applies pending migrations to the local miniflare D1 on start.
- **Do not use `bun run db:push`** — `drizzle.config.ts` has no `dbCredentials`,
  so it fails for the D1 HTTP driver.

## Deployment (Cloudflare via Alchemy)

- Worker + D1: `bun run deploy`
- Trigger.dev tasks: `bun run deploy:background`
- Tear down: `bun run destroy`

See [Deploying to Cloudflare with Alchemy](https://www.better-t-stack.dev/docs/guides/cloudflare-alchemy).

## Project Structure

```
sr-custom-emailing/
├── apps/
│   └── server/        # Hono entry; mounts oRPC RPC + OpenAPI handlers
├── packages/
│   ├── api/           # oRPC routers (flow endpoints + internal cache) + auth
│   ├── background/    # Trigger.dev tasks + integrations (Apify, AI, Sheets, Instantly, Clay)
│   ├── db/            # Drizzle schema, queries, D1 migrations
│   ├── env/           # Typed Cloudflare Worker env bindings
│   ├── infra/         # Alchemy infra (Worker + D1)
│   └── config/        # Shared tsconfig base
```

## Available Scripts

- `bun run dev` — Worker (Alchemy) + tasks (`trigger dev`)
- `bun run dev:server` / `bun run dev:background` — one side only
- `bun run check-types` — TypeScript across all packages
- `bun run db:generate` — generate a Drizzle migration from the schema
- `bun run deploy` / `bun run deploy:background` / `bun run destroy`
- `bun run check` / `bun run fix` — Ultracite (Biome) lint + format

## Git Hooks and Quality

- Initialize hooks: `bun run prepare`
- Before committing: `bun x ultracite fix` then `bun run check-types`
- No automated test files (project decision); verification is type-check +
  Ultracite + manual smoke.
