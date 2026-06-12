# Handoff — Two-flow LinkedIn Automation

## Source of truth

`impl-plan.md` holds the two-flow architecture spec. `project_testing.md` is the
runtime runbook. This file tracks progress + decisions.

## Response style

User wants terse "caveman" chat replies until they say `stop caveman` /
`normal mode`. Does NOT affect doc/code style — chat prose only.

## Status — restructure COMPLETE (code + static gates)

The original single email pipeline was restructured into two named flows. All
code is implemented; `bun run check-types`, `bun x ultracite check`, and
`bun run db:generate` ("No schema changes") are green. Runtime smoke is pending
real keys.

- ✅ Flow A `ourLinkedinCommentTracking` — our posts -> LinkedIn DMs -> Google Sheet
- ✅ Flow B `someoneElsePostScraping` — their posts -> emails -> Instantly campaign
- ⏳ Manual smoke (needs real keys; follow `project_testing.md`)

## What changed in the restructure

1. **DB:** `auto_emailing` gained `source` (`comment_tracking` | `someone_else`)
   and `dm1_body`/`dm2_body`/`dm3_body` (migration `0003_nifty_blue_blade.sql`,
   forward-only nullable ALTERs). The 6 email columns + 3 magnet-id columns stay.
2. **Authoring** (`lead-magnet-selection.ts`): kept `generatePostEmailSequence`
   (Flow B); added `generatePostDmSequence` (Flow A). Shared catalog, validation,
   and poster-first-name helpers. DM copy keeps the `{{firstname}}` merge tag in
   the stored copy and bakes the AI-inferred hard-to-fill role into DM 3; DM
   bodies have no subjects. The generate step substitutes `{{firstname}}` per
   lead before writing to the Sheet.
3. **Cache:** `postCacheUpdatePayloadSchema` is now a zod discriminated union on
   `source`; `upsertScrapedPost` takes a matching union; `postCacheRowSchema` +
   `getPostsByUrls`/`getPostByUrl` carry `source` + DM fields. `insertPendingPost`
   takes `(url, source)`.
4. **Internal endpoints renamed** to `/internal/post-cache/update` and
   `/internal/post-cache/batch-get` (dropped the `/automation` prefix). Client
   paths in `internal-api.ts` updated to match.
5. **Flow A sink** (`google-sheets.ts`): `appendEmailRows`/`EmailSheetRow` ->
   `appendDmRows`/`DmSheetRow`. Columns: `Date | Name | LinkedIn URL | Follow Up
   | 2nd Follow Up | 3rd Follow Up`. The 3 Follow Up cells are the DM bodies
   verbatim; rows without a LinkedIn URL are dropped. No `${firstName}`
   substitution in this flow.
6. **Flow B sink** (`instantly.ts`, new): `addLeadsToCampaign` pushes each lead
   to one Instantly campaign (`INSTANTLY_CAMPAIGN_ID`) via `POST /api/v2/leads`
   with the rendered email copy as `custom_variables`. `${firstName}` is
   substituted per lead before pushing (Instantly only fills `{{...}}` tags).
   **Close sink added** (`close.ts`, new): `addLeadsToClose` also creates each
   emailed lead in Close as a plain lead (no opportunity / pipeline) via
   `POST https://api.close.com/api/v1/lead/`, Basic auth from
   `CLOSE_ENCODED_API_KEY` (pre-base64 `apikey:`, sent verbatim). Runs after the
   Instantly push in `someone-else-generate`. Maps company -> lead, prospect ->
   contact, plus the org's lead/contact custom fields (Lead Source constant
   `Lead Scraping`, Company LinkedIn URL, Company Type = `[staffinClassification]`
   choice, contact LinkedIn URL); ids hardcoded in `close.ts`.
7. **Tasks:** `scrape-post`/`email-generation` removed; replaced by
   `comment-tracking-scrape`, `comment-tracking-generate`, `someone-else-scrape`,
   `someone-else-generate` (ids match file names). `triggerXxx` wrappers in
   `index.ts` rewritten to 4 functions; `scrapePostPayloadSchema` +
   `leadBatchPayloadSchema` shared.
8. **Routers:** `automation.ts` -> `our-linkedin-comment-tracking.ts` +
   `someone-else-post-scraping.ts`, each `startScraping`/`startGenerate`,
   registered under keys `ourLinkedinCommentTracking` / `someoneElsePostScraping`.
   Both keep `internalProcedure` (`x-internal-secret`).
9. Removed the stray `google-sheets.test.js` (no-tests decision).

## Commenter harvest -> Clay (added after the restructure)

Each scrape command (Discord `our-posts`/`someone-else` + the public `*/scrape`
endpoints, via `runScrape`) now also fires `harvest-commenters`. It starts an
**async** Apify run of `harvestapi/linkedin-post-comments`
(`startCommenterScrape`) with an ad-hoc completion webhook ->
`POST /apify/commenters/{flow}` (header `x-apify-webhook-secret`, normalized
`postUrl` in the query). The Worker route (`apps/server/src/apify-webhook.ts` ->
`packages/api/src/commenters-service.ts`) validates the secret + flow and
enqueues `forward-commenters-to-clay`, which fetches the dataset
(`fetchApifyDatasetItems`), parses + dedups commenters (`parseCommenters`), and
POSTs them to the Clay enricher table (`clay.ts` `sendCommentersToClay`). Clay
enriches and posts each lead back to the matching `/{flow}` generate endpoint —
`flow` is the flag threaded through the whole Apify -> webhook -> Clay round trip.

- New files: `background/src/clay.ts`, `trigger/harvest-commenters.task.ts`,
  `trigger/forward-commenters-to-clay.task.ts`, `api/src/commenters-service.ts`,
  `server/src/apify-webhook.ts`. New `apify.ts` exports; new
  `triggerHarvestCommenters` + `triggerForwardCommentersToClay`. `runScrape` now
  also returns `commentersRunId`.
- Both new tasks are `maxAttempts: 1` (starting an Apify run / POSTing to Clay are
  non-idempotent; re-trigger manually on failure).
- Async (not run-sync) because a 1000-comment run can exceed Apify's 300s sync cap.
- The Apify completion webhook needs a **publicly reachable** Worker, so the
  harvest path can't be smoke-tested on pure localhost dev.

## Locked product decisions (from the user)

- DM `{{firstname}}` = per-lead merge tag, substituted with the commenter's first
  name (`getFirstName`) at generate time. Hard-to-fill role = AI-inferred + baked
  in (not a tag).
- Flow B authors email sequences (subject + body x3).
- Instantly = add leads to one campaign (id from env) with custom variables.

## Standing decisions / rules that bite

- **No automated tests anywhere.** Verify with type-check + ultracite + db:generate
  + manual smoke.
- Harness rules in play: `ts-no-tiny-functions` (don't extract one-expression
  helpers), `ts-no-return-type` (name types, no `ReturnType<typeof fn>` contracts
  — `google-sheets.ts` names `SheetsClient = sheets_v4.Sheets`), `ts-set-map`
  (Record for static tables; Set/Map for dynamic — our dedup/lookup Maps are
  legit). Run `bun x ultracite fix` then resolve non-fixables. `biome-ignore` and
  `@ts-expect-error` are forbidden.

## DB / deployment (unchanged from before)

- D1 is wired via **Alchemy** (`adopt: true`), not drizzle-kit. `bun run db:push`
  fails (no `dbCredentials`); migrations apply through Alchemy's `migrationsDir`
  on `bun run deploy` (forward-only FILES, not a diff). Remote D1
  `sr-custom-emailing-database-a3tech` (`c15c29fa-…`) exists.
- Future schema change: `bun run db:generate` -> `bun run deploy`.

## Env state (supply real values before runtime)

`packages/infra/.env` (Worker-side): `ALCHEMY_PASSWORD`, `INTERNAL_API_SECRET`,
`TRIGGER_*`, `CORS_ORIGIN`. Placeholders to replace: `APIFY_API_KEY`,
`ANTHROPIC_API_KEY`, `INSTANTLY_API_KEY`.
Add `APIFY_WEBHOOK_SECRET` (Worker; identical value on the Trigger project).

Trigger.dev project env still needed: `APIFY_API_KEY`, `ANTHROPIC_API_KEY`,
`GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB?` (Flow A),
`INSTANTLY_API_KEY`, **`INSTANTLY_CAMPAIGN_ID`** (Flow B), `INTERNAL_API_URL`,
`INTERNAL_API_SECRET`. See the table in `project_testing.md` Phase 1.
Commenter harvest adds (Trigger env): `CLAY_ENRICHER_TABLE_URL`,
`CLAY_ENRICHER_AUTH_TOKEN`, `APIFY_WEBHOOK_SECRET`, optional
`APIFY_LINKEDIN_COMMENTS_ACTOR_ID` / `APIFY_COMMENTS_MAX_ITEMS` (default 1000).

## Verification commands

```bash
bun run check-types     # green
bun x ultracite check   # green
bun run db:generate     # "No schema changes"
```

## Next action

Run the smoke in `project_testing.md` once real keys are set: Flow A (Phase 4)
and Flow B (Phase 5). Build/choose the Instantly campaign and wire its sequence
steps to the `{{email1Body}}`-style custom variables before the Flow B push.
