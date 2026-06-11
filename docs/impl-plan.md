# Implementation Plan — Two-flow LinkedIn Automation

Single source of truth for this feature. The code is implemented and type/lint
clean; runtime smoke needs real keys (see `project_testing.md`).

## Goal

Two outreach pipelines that share scraping, the D1 cache, and AI magnet
selection, but differ in copy style and destination:

- **Flow A — `ourLinkedinCommentTracking`**: people who comment on **our**
  LinkedIn posts get short **LinkedIn DMs**. Output: a Google Sheet row per
  commenter.
- **Flow B — `someoneElsePostScraping`**: leads from **someone else's** post get
  cold **emails** pushed into an **Instantly** campaign.

Both: scrape the post (Apify) -> Claude identifies the poster's lead magnet,
selects 3 distinct SuperRecruiter magnets, and authors the copy -> cache on D1
-> a generate step fans the cached copy out per lead.

## Core decisions

- **Apify** scrapes the main post content; runs only inside Trigger tasks.
- **D1 is the cache / source of truth.** One table `auto_emailing`, unique on
  `original_post_url`, with a `source` discriminator (`comment_tracking` |
  `someone_else`) selecting which copy columns are authoritative.
- Magnet selection + copy authoring are **per post**, not per commenter. Every
  commenter on a post gets the same authored copy.
- **Commenter harvest (both flows).** The same scrape command also fires
  `harvest-commenters`, which starts an **async** Apify run of
  `harvestapi/linkedin-post-comments` with a completion webhook pointing at
  `/apify/commenters/{flow}`. The webhook enqueues `forward-commenters-to-clay`,
  which fetches the run's dataset and POSTs the parsed commenters to
  `CLAY_ENRICHER_TABLE_URL` (auth via `CLAY_ENRICHER_AUTH_TOKEN`) tagged with
  `flow`. Clay enriches and posts each lead back
  to the matching generate endpoint (it picks the URL from `flow`). `flow` is the
  flag that survives the Apify -> webhook -> Clay round trip. Async (not
  run-sync) because a 1000-comment run can exceed Apify's 300s sync cap.
- **Flow A (DMs):** Claude authors 3 short DM bodies (no subjects). `{{firstname}}`
  is a **per-lead merge tag** kept verbatim in the stored copy; the hard-to-fill
  role is **inferred from the post and baked in** by Claude. The generate step
  substitutes `{{firstname}}` per lead (`getFirstName(lead.name)`) before writing
  to the Sheet.
- **Flow B (emails):** Claude authors the 3-email sequence (subject + body x3)
  with the `${firstName}` placeholder. The generate step substitutes
  `${firstName}` per lead (Claude's `${...}` is not an Instantly tag) and pushes
  the rendered copy to one Instantly campaign as **custom variables**.
- **No automated tests.** Verification = `bun run check-types`,
  `bun x ultracite check`, `bun run db:generate` (clean), and manual smoke. Keep
  helpers pure and parsers isolated, but add no `*.test.*` files.

## Architecture / data flow

```
Flow A: ourLinkedinCommentTracking
  POST /our-linkedin-comment-tracking/scrape  -> D1 check; insert pending (source=comment_tracking); trigger comment-tracking-scrape
      comment-tracking-scrape: Apify -> generatePostDmSequence (3 magnets + 3 DM bodies)
                            -> POST /internal/post-cache/update (source=comment_tracking, dm1/2/3)
  POST /our-linkedin-comment-tracking/generate -> trigger comment-tracking-generate
      comment-tracking-generate: drop leads w/o LinkedIn URL -> group by url -> /internal/post-cache/batch-get
                            -> fail on any missing/unscraped -> write DM rows verbatim -> Google Sheet

Flow B: someoneElsePostScraping
  POST /someone-else-post-scraping/scrape  -> D1 check; insert pending (source=someone_else); trigger someone-else-scrape
      someone-else-scrape: Apify -> generatePostEmailSequence (3 magnets + 3 emails)
                        -> POST /internal/post-cache/update (source=someone_else, email1/followUp1/2)
  POST /someone-else-post-scraping/generate -> trigger someone-else-generate
      someone-else-generate: drop leads w/o email -> group by url -> /internal/post-cache/batch-get
                        -> fail on any missing/unscraped -> substitute ${firstName} -> addLeadsToCampaign (Instantly)

Commenter harvest (both flows; fires alongside each scrape above)
  scrape command -> trigger harvest-commenters
      harvest-commenters: start ASYNC Apify (harvestapi/linkedin-post-comments) + ad-hoc webhook -> {WORKER}/apify/commenters/{flow}?postUrl=
  POST /apify/commenters/{flow}  (Apify completion webhook; header x-apify-webhook-secret) -> trigger forward-commenters-to-clay
      forward-commenters-to-clay: fetch dataset -> parse + dedup commenters -> POST CLAY_ENRICHER_TABLE_URL (header x-clay-webhook-auth: CLAY_ENRICHER_AUTH_TOKEN) { flow, originalPostUrl, leads }
  Clay enriches -> POST the matching {flow} generate endpoint (Clay routes by flow)
```

Tasks have no Worker D1 binding, so all D1 access goes through the protected
internal endpoints (`x-internal-secret`). All public + internal routes sit under
the OpenAPI prefix `/api-reference`.

## Google Sheet contract (Flow A)

One row per commenter; columns in order:
`Date | Name | LinkedIn URL | Follow Up | 2nd Follow Up | 3rd Follow Up`.
The 3 "Follow Up" columns are the 3 authored DM bodies with the commenter's
first name substituted in (`{{firstname}}` -> `getFirstName(Name)`).
`appendDmRows` writes the header row when the tab is empty. Rows without a
LinkedIn URL are dropped (cannot be DM'd).

## Instantly contract (Flow B)

`POST https://api.instantly.ai/api/v2/leads`, `Authorization: Bearer
INSTANTLY_API_KEY`, body `{ campaign: INSTANTLY_CAMPAIGN_ID, email, first_name,
last_name, company_name, custom_variables: { email1Subject, email1Body,
followUp1Subject, followUp1Body, followUp2Subject, followUp2Body } }`. The
campaign's sequence steps reference the custom variables by name (e.g.
`{{email1Body}}`). Leads without an email are skipped.

## Files (where things live)

- `packages/db/src/schema/auto-emailing.ts` — table (+`source`, `dm1/2/3_body`).
- `packages/db/src/index.ts` — `upsertScrapedPost` (discriminated input),
  `getPostByUrl`, `getPostsByUrls`, `insertPendingPost(url, source)`.
- `packages/background/src/types.ts` — payload/row zod schemas; cache-update is a
  discriminated union on `source`; `leadBatchPayloadSchema` shared by both flows.
- `packages/background/src/lead-magnets.ts` — typed magnet catalog + helpers.
- `packages/background/src/lead-magnet-selection.ts` — `generatePostEmailSequence`
  + `generatePostDmSequence` (shared catalog/validation/poster-name helpers).
- `packages/background/src/emails.ts` — `EmailSequence` + `applyLeadVariables`
  (Flow B) and `DmSequence` + `DM_FIRST_NAME_TAG` (Flow A).
- `packages/background/src/apify.ts` — `scrapeLinkedinPost` + isolated parser;
  `startCommenterScrape` (async run + ad-hoc webhook), `fetchApifyDatasetItems`,
  `parseCommenters` (dedup by profile URL, drop profile-less commenters).
- `packages/background/src/clay.ts` — `sendCommentersToClay` (POST commenters to
  `CLAY_ENRICHER_TABLE_URL`, auth via `CLAY_ENRICHER_AUTH_TOKEN`, mapped to
  `clayLeadSchema` field names + `flow`).
- `packages/background/src/google-sheets.ts` — `appendDmRows` + `DmSheetRow`.
- `packages/background/src/instantly.ts` — `addLeadsToCampaign` + `InstantlyLead`.
- `packages/background/src/internal-api.ts` — task->Worker cache client.
- `packages/background/src/trigger/*.task.ts` — the 6 tasks (4 flow tasks +
  `harvest-commenters`, `forward-commenters-to-clay`).
- `packages/background/src/index.ts` — 6 `triggerXxx` wrappers + schema re-exports.
- `packages/api/src/routers/` — `our-linkedin-comment-tracking.ts`,
  `someone-else-post-scraping.ts`, `internal.ts`, registered in `index.ts`.
- `packages/api/src/auth.ts` — `internalProcedure` (`x-internal-secret`).
- `packages/api/src/commenters-service.ts` — `forwardHarvestedCommenters`
  (validate `flow`, enqueue the forward task) so the server depends only on `api`.
- `apps/server/src/apify-webhook.ts` — `handleApifyCommentersWebhook` (Hono route
  `POST /apify/commenters/:flow`, shared-secret guard, SUCCEEDED-only forward).

## Environment & secrets

API Worker (`packages/infra/alchemy.run.ts` bindings): `DB`, `CORS_ORIGIN`,
`TRIGGER_SECRET_KEY`, `INTERNAL_API_SECRET`, `APIFY_WEBHOOK_SECRET`,
`DISCORD_PUBLIC_KEY`, `MAKE_WEBHOOK_URL` (Discord `linkedin` interactions are
verified in the Worker and forwarded straight to the Make webhook — no
intermediate verifier worker).

Trigger.dev project env (task-side, read from `process.env`):
- `APIFY_API_KEY` (+ optional `APIFY_LINKEDIN_POST_ACTOR_ID`,
  `APIFY_LINKEDIN_COMMENTS_ACTOR_ID`, `APIFY_COMMENTS_MAX_ITEMS` default 1000)
- `ANTHROPIC_API_KEY`
- `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB?` (Flow A)
- `INSTANTLY_API_KEY`, `INSTANTLY_CAMPAIGN_ID` (Flow B)
- `INTERNAL_API_URL`, `INTERNAL_API_SECRET`
- `CLAY_ENRICHER_TABLE_URL` + `CLAY_ENRICHER_AUTH_TOKEN` (commenter batches POSTed
  to the Clay enricher table; token sent as the `x-clay-webhook-auth` header)
- `APIFY_WEBHOOK_SECRET` (identical to the Worker; sent as the
  `x-apify-webhook-secret` header on the harvest completion webhook)

## Verification

```bash
bun run check-types     # all packages
bun x ultracite check   # lint/format
bun run db:generate     # must report "No schema changes"
```
Runtime smoke: `project_testing.md`.
