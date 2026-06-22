# Project Testing Guide — Two-flow LinkedIn Automation

End-to-end test procedure for both pipelines. Run the phases **in order**; each
phase has a gate that must pass before the next. Behaviour spec is `impl-plan.md`;
this is the runbook.

## System under test (recap)

```
Flow A — ourLinkedinCommentTracking (our posts -> LinkedIn DMs -> Google Sheet)
  POST /our-linkedin-comment-tracking/scrape   -> trigger comment-tracking-scrape
      Apify -> Claude (3 magnets + 2 DM bodies) -> /internal/post-cache/update (source=comment_tracking)
  POST /our-linkedin-comment-tracking/generate -> trigger comment-tracking-generate
      group leads -> /internal/post-cache/batch-get -> write DM bodies verbatim -> Google Sheet

Flow B — someoneElsePostScraping (their posts -> emails -> Instantly + Close)
  POST /someone-else-post-scraping/scrape   -> trigger someone-else-scrape
      Apify -> Claude (3 magnets + 3 emails) -> /internal/post-cache/update (source=someone_else)
  POST /someone-else-post-scraping/generate -> trigger someone-else-generate
      group leads -> /internal/post-cache/batch-get -> substitute ${firstName} -> Instantly campaign -> Close leads

Commenter harvest (both flows; fires on every scrape command, incl. Discord)
  scrape -> trigger harvest-commenters -> async Apify (harvestapi/linkedin-post-comments) + completion webhook
  POST /apify/commenters/{flow}  (Apify webhook) -> trigger forward-commenters-to-clay
      fetch dataset -> dedup commenters -> POST Clay enricher table -> Clay enriches -> POST {flow} generate endpoint
```

All routes are mounted under the OpenAPI prefix `/api-reference`. Tasks run on
Trigger.dev (not the Worker) and reach D1 only via the secret-protected internal
endpoints.

---

## Phase 0 — Static checks (no secrets required)

```bash
bun install
bun run db:generate   # must say "No schema changes, nothing to migrate"
bun run check-types   # all packages compile
bun x ultracite check # lint/format clean
```

**Pass:** all succeed with no errors.

---

## Phase 1 — Provision accounts & secrets

Placeholders (`APIFY_API_KEY=123`, etc.) WILL fail at runtime.

### 1.1 Apify

- API token -> `APIFY_API_KEY`. Default actor `apimaestro/linkedin-post-detail`
  (override `APIFY_LINKEDIN_POST_ACTOR_ID`). Confirm the actor returns post text
  in one of `text/content/postText/commentary/description` and the author name in
  `authorName/authorFullName/posterName/fullName/name` or a nested `author`.
- Commenter harvest actor `harvestapi/linkedin-post-comments` (override
  `APIFY_LINKEDIN_COMMENTS_ACTOR_ID`; cap with `APIFY_COMMENTS_MAX_ITEMS`,
  default 1000). Uses the same `APIFY_API_KEY`. Input
  `{ posts:[url], maxItems, scrapeReplies:false }`; commenter at
  `actor.{name,linkedinUrl}`, text at `commentary`.

### 1.2 Anthropic

- `ANTHROPIC_API_KEY`. Model `claude-sonnet-4-5`.

### 1.3 Google Sheets (Flow A) — service account

- Create a service account + JSON key -> `GOOGLE_SERVICE_ACCOUNT_JSON` (single
  line). Sheet id -> `GOOGLE_SHEET_ID` (optional tab -> `GOOGLE_SHEET_TAB`,
  default `Sheet1`). **Share the Sheet with the SA `client_email` as Editor** or
  writes 403.

### 1.4 Instantly + Close (Flow B)

- Instantly: API key -> `INSTANTLY_API_KEY`. Build/choose one campaign; copy its
  id -> `INSTANTLY_CAMPAIGN_ID`. The campaign's sequence steps should reference
  `{{firstname}}`, `{{posterfullname}}`, `{{postlabel}}`, `{{article}}`,
  `{{what}}`, `{{solvesthis}}`, `{{painline}}`, `{{followup1article}}`,
  `{{followup1what}}`, `{{followup1solvesthis}}`, `{{followup1painline}}`,
  `{{followup2article}}`, `{{followup2what}}`, `{{followup2solvesthis}}`, and
  `{{followup2painline}}`.
- Close: base64-encode the `apikey:` HTTP Basic credential (key as username,
  empty password) -> `CLOSE_ENCODED_API_KEY` (sent verbatim as `Basic <value>`).
  Each emailed lead is created as a plain Close lead (no opportunity / pipeline).
  The org-specific custom-field ids (Lead Source / Company LinkedIn URL / Company
  Type / contact LinkedIn URL) are hardcoded in `close.ts`; `Company Type` is a
  choice field, so `staffinClassification` values must match a Close option or
  that lead's POST 400s. `Lead Source` is the constant `Lead Scraping`.

### 1.5 Internal callback secret + URL

- `INTERNAL_API_SECRET` set **identically** on the Worker
  (`packages/infra/.env`) and the Trigger.dev project env. Mismatch/unset -> 401.
- `INTERNAL_API_URL` (Trigger env) = the Worker base URL reachable from where the
  task runs (local `trigger dev` -> local Worker; deployed -> deployed Worker).
  The task appends the `/api-reference` prefix; set only the base.

### 1.6 Clay enricher + Apify webhook secret

- `CLAY_ENRICHER_TABLE_URL` (Clay webhook/table URL) + `CLAY_ENRICHER_AUTH_TOKEN`
  (sent as the `x-clay-webhook-auth` header). Trigger env. `forward-commenters-to-clay`
  POSTs `{ flow, originalPostUrl, leads:[{ flow, name, personalLinkedinUrl,
  originalComment, originalPostUrl }] }`. Configure Clay to enrich and POST each
  enriched row back to the `/{flow}` generate endpoint based on `flow`.
- `APIFY_WEBHOOK_SECRET` set **identically** on the Worker (`packages/infra/.env`)
  and the Trigger.dev project env. The harvest task sends it as the
  `x-apify-webhook-secret` header; `/apify/commenters/:flow` 401s on mismatch.
- **Reachability:** Apify's completion webhook calls the Worker directly, so the
  Worker base (`INTERNAL_API_URL`) must be **publicly reachable**. Use the
  deployed topology (or a tunnel) for the harvest path; pure localhost dev cannot
  receive the Apify callback.

### Env placement summary

| Var                                                                   | Worker (`packages/infra/.env`) | Trigger.dev project env |
| --------------------------------------------------------------------- | ------------------------------ | ----------------------- |
| `INTERNAL_API_SECRET`                                                 | ✅ (identical)                 | ✅ (identical)          |
| `TRIGGER_SECRET_KEY`, `CORS_ORIGIN`, D1 binding                       | ✅                             | —                       |
| `APIFY_API_KEY` (+ `APIFY_LINKEDIN_POST_ACTOR_ID?`)                   | —                              | ✅                      |
| `ANTHROPIC_API_KEY`                                                   | —                              | ✅                      |
| `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB?` | —                              | ✅ (Flow A)             |
| `INSTANTLY_API_KEY`, `INSTANTLY_CAMPAIGN_ID`                          | —                              | ✅ (Flow B)             |
| `CLOSE_ENCODED_API_KEY`                                              | —                              | ✅ (Flow B)             |
| `INTERNAL_API_URL`                                                    | —                              | ✅                      |
| `CLAY_ENRICHER_TABLE_URL`, `CLAY_ENRICHER_AUTH_TOKEN`                 | —                              | ✅                      |
| `APIFY_WEBHOOK_SECRET`                                                | ✅ (identical)                 | ✅ (identical)          |
| `APIFY_LINKEDIN_COMMENTS_ACTOR_ID?`, `APIFY_COMMENTS_MAX_ITEMS?`      | —                              | ✅                      |

> Trigger.dev task code does NOT read `packages/infra/.env` at runtime; set
> task-side secrets in the Trigger.dev project env. `trigger dev` loads
> `packages/infra/.env` locally via `trigger.config.ts`.

---

## Phase 2 — Database migration

The D1 table `auto_emailing` must include `source`, the 6 email columns, and the
3 `dm*_body` columns (migrations `0001`/`0003`).

```bash
bun run deploy   # adopts remote D1, applies pending migration FILES, deploys Worker
```

Local miniflare D1 gets pending migrations on `bun run dev`.

**Gate:** `auto_emailing` has the magnet-id, email, and DM columns + `source`.

---

## Phase 3 — Bring up services + auth wiring

```bash
bun run dev                 # Topology A (local): alchemy dev Worker + trigger dev
# or: bun run deploy && bun run deploy:background   # Topology B (deployed)
export BASE="http://localhost:3001"   # local Alchemy dev Worker (or deployed URL)
export SECRET="<INTERNAL_API_SECRET>"
```

### 3.1 Liveness

```bash
curl -s "$BASE/"   # -> "See /rpc and the appropiate route!"
```

### 3.2 Internal auth (no data)

```bash
# missing secret -> 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "$BASE/api-reference/internal/post-cache/batch-get" \
  -H "content-type: application/json" \
  -d '{"originalPostUrls":["https://example.com"]}'        # expect 401

# correct secret -> 200 {"rows":[]}
curl -s -X POST "$BASE/api-reference/internal/post-cache/batch-get" \
  -H "content-type: application/json" -H "x-internal-secret: $SECRET" \
  -d '{"originalPostUrls":["https://example.com"]}'         # expect {"rows":[]}
```

**Gate:** 401 without secret, 200 `{"rows":[]}` with secret.

---

## Phase 4 — Flow A (comment tracking -> DMs -> Sheet)

```bash
export POST_URL="https://www.linkedin.com/posts/<real-activity>"
```

### 4.1 Scrape

```bash
curl -s -X POST "$BASE/api-reference/our-linkedin-comment-tracking/scrape" \
  -H "content-type: application/json" -d "{\"originalPostUrl\":\"$POST_URL\"}"
# expect {"status":"started","runId":"run_…"}
```

### 4.2 Watch `comment-tracking-scrape`

- SUCCEEDED; logs "Scraped LinkedIn post" + "Authored DM sequence" (3 ids).

### 4.3 Inspect the row

```bash
curl -s -X POST "$BASE/api-reference/internal/post-cache/batch-get" \
  -H "content-type: application/json" -H "x-internal-secret: $SECRET" \
  -d "{\"originalPostUrls\":[\"$POST_URL\"]}" | jq
```

Expect `scraped:true`, `source:"comment_tracking"`, `dm1Body/dm2Body`
non-null, each containing `{{firstname}}`; `dm3Body` and the 6 email fields null.

### 4.4 Cache hit

Re-run 4.1 -> `{"status":"cached",…}`, no new run.

### 4.5 Generate

```bash
curl -s -X POST "$BASE/api-reference/our-linkedin-comment-tracking/generate" \
  -H "content-type: application/json" \
  -d "{\"leads\":[{\"name\":\"Jane Doe\",\"originalPostUrl\":\"$POST_URL\",\"personalLinkedinUrl\":\"https://linkedin.com/in/janedoe\"}]}"
# expect {"runId":"run_…"}
```

### 4.6 Watch run + Sheet

- `comment-tracking-generate` SUCCEEDED; log "Appended DM rows" `rowsWritten:1`.
- Sheet has one row, columns: `Date Added | Person's Name | LinkedIn URL |
  LinkedIn Follow Up DM | LinkedIn Follow Up DM II | Company | Status | Lead
  Magnet / Asset Requested | Source Post URL | Notes`. The 2 DM cells have
  `{{firstname}}` substituted to the lead's first name (`Jane` for `Jane Doe`);
  `Status` is `Needs DM`; `Notes` is blank.

### 4.7 Negative — generate before scrape

Use an unscraped URL -> run FAILS `Cannot generate DMs; posts not scraped yet:
<url>`. No rows written.

---

## Phase 5 — Flow B (someone else -> emails -> Instantly + Close)

### 5.1 Scrape

```bash
curl -s -X POST "$BASE/api-reference/someone-else-post-scraping/scrape" \
  -H "content-type: application/json" -d "{\"originalPostUrl\":\"$POST_URL\"}"
```

Watch `someone-else-scrape` -> SUCCEEDED. Batch-get shows `source:"someone_else"`
and the 6 email fields non-null (`${firstName}` in each body); DM fields null.

### 5.2 Generate

```bash
curl -s -X POST "$BASE/api-reference/someone-else-post-scraping/generate" \
  -H "content-type: application/json" \
  -d "{\"leads\":[{\"name\":\"Jane Doe\",\"email\":\"jane@acme.example\",\"companyName\":\"Acme\",\"originalPostUrl\":\"$POST_URL\",\"personalLinkedinUrl\":\"https://linkedin.com/in/janedoe\"}]}"
# expect {"runId":"run_…"}
```

Watch `someone-else-generate` -> SUCCEEDED; logs "Pushed leads to Instantly"
`added:1` then "Created leads in Close" `added:1`. In Instantly the lead appears
in the campaign with those custom variables populated: poster full name,
lowercase three-word `postlabel`, primary `article` (`a`/`an`),
`what`/`solvesthis`/`painline`, follow-up one
`followup1article`/`followup1what`/`followup1solvesthis`/`followup1painline`,
follow-up two
`followup2article`/`followup2what`/`followup2solvesthis`/`followup2painline`,
and per-lead `firstname`.
In Close a new lead exists (company name + website,
one contact with the work email + LinkedIn URL, Lead Source `Lead Scraping`); no
opportunity is attached.

### 5.3 Negative — generate before scrape

Unscraped URL -> run FAILS `Cannot generate emails; posts not scraped yet: <url>`.

---

## Phase 5b — Commenter harvest -> Clay (both flows)

Requires the **deployed** Worker (Apify must reach `/apify/commenters/:flow`).

1. Run a scrape (Phase 4.1 / 5.1) or the Discord command. The response/reply
   carries a `commentersRunId`; `harvest-commenters` appears in Trigger.dev.
2. `harvest-commenters` SUCCEEDED; log "Started commenter harvest" with the Apify
   run id. The `harvestapi/linkedin-post-comments` run completes in the Apify
   console.
3. On completion Apify POSTs `/apify/commenters/{flow}`, which enqueues
   `forward-commenters-to-clay`. That task SUCCEEDED; log "Forwarded commenters to
   Clay" with `commenterCount`. A post with no usable commenters logs
   `forwarded:false` and skips Clay.
4. The Clay table receives one batch of commenter rows tagged `flow`; Clay
   enrichment fires and posts enriched rows back to the `/{flow}` generate
   endpoint, feeding Phase 4.5 / 5.2.

---

## Phase 6 — Failure-mode drills (optional)

| Drill                      | How                                        | Expected                                                                                              |
| -------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Bad internal secret        | wrong `x-internal-secret`                  | 401                                                                                                   |
| Apify empty/blocked        | unreadable post                            | scrape FAILS `No LinkedIn post content found`; no scraped row                                         |
| Invalid magnet id          | (rare)                                     | scrape FAILS `Unknown lead magnet id(s)` / `must be distinct`                                         |
| Google not shared          | unshare Sheet from SA, run Flow A generate | task fails with Google 403                                                                            |
| Instantly bad key/campaign | wrong key/campaign id                      | `someone-else-generate` fails `Instantly create-lead failed …`                                        |
| Close bad key              | wrong `CLOSE_ENCODED_API_KEY`              | `someone-else-generate` fails `Close create-lead failed …` (after the Instantly push)                 |
| Close bad Company Type     | `staffinClassification` not a Close option | that lead's Close POST 400s -> `someone-else-generate` fails `Close create-lead failed …`              |
| Duplicate run              | re-run a generate with same lead           | a second row/lead is added (append/push not idempotent; `maxAttempts:1` only blocks auto-retry dupes) |
| Bad webhook secret         | wrong/absent `x-apify-webhook-secret`      | `/apify/commenters/:flow` 401; no Clay forward                                                        |
| Apify comments run failed  | aborted/timed-out commenter run            | webhook route logs + 200; no `forward-commenters-to-clay`                                             |
| Clay table unreachable     | wrong `CLAY_ENRICHER_TABLE_URL`/token      | `forward-commenters-to-clay` fails `Clay webhook failed …`                                            |

---

## Done when

1. Phase 0 green. 2. Flow A: scrape SUCCEEDED, row complete with DM bodies, cache
   hit works, DM rows in the Sheet, generate-before-scrape fails. 3. Flow B: scrape
   SUCCEEDED with email fields, leads land in Instantly with custom variables and
   a matching plain lead is created in Close,
   generate-before-scrape fails. 4. Commenter harvest: `harvest-commenters` +
   `forward-commenters-to-clay` SUCCEEDED and the Clay table receives the
   `flow`-tagged batch.
