# Project Testing Guide — LinkedIn Lead Magnet Emailing Automation

End-to-end test procedure for the scrape → author → email-generation pipeline.
Run the phases **in order**; each phase has a gate that must pass before the next.
Source of truth for behaviour is `impl-plan.md`; this doc is the runbook.

## System under test (recap)

```
Client ─POST /automation/linkedin-scraping──▶ Worker ─▶ D1 cache check
                                                       └▶ trigger scrape-post task
  scrape-post: Apify scrape ─▶ Claude (select 3 magnets + author 3 emails)
                            └▶ POST internal /post-cache/update ─▶ D1 row (scraped=true)

Client ─POST /automation/email-generation──▶ Worker ─▶ trigger email-generation task
  email-generation: normalize+group leads ─▶ POST internal /post-cache/batch-get
                  └▶ substitute ${firstName} ─▶ append rows ─▶ Google Sheet
```

All public routes are mounted under the OpenAPI prefix `/api-reference`.
Tasks run on Trigger.dev (not the Worker) and reach D1 only via the
secret-protected internal endpoints.

---

## Phase 0 — Static checks (no secrets required)

Gate before any runtime testing.

```bash
bun install
bun run db:generate   # no-op unless schema changed; confirms migrations are current
bun run check-types   # all packages compile
bun x ultracite check # lint/format clean
```

**Pass:** all three succeed with no errors.

---

## Phase 1 — Provision accounts & secrets

No runtime test passes until these are real. Placeholders (`APIFY_API_KEY=123`,
`ANTHROPIC_API_KEY=123`) WILL fail.

### 1.1 Apify
1. Create an Apify account; copy the API token → `APIFY_API_KEY`.
2. Pick a LinkedIn **single-post** actor that returns the main post text for a
   URL. Default in code: `apimaestro/linkedin-post-detail`
   (override with `APIFY_LINKEDIN_POST_ACTOR_ID`).
3. **Standalone actor smoke (do this first, it de-risks everything):**
   - In the Apify console, run the actor with input `{ "postUrls": ["<real post URL>"] }`.
   - Inspect the dataset output. Confirm the post text lands in one of:
     `text`, `content`, `postText`, `commentary`, `description`
     (the fields `parseLinkedinPost` probes), and the author name in
     `authorName` / `authorFullName` / `posterName` / `fullName` / `name`
     or a nested `author` object.
   - If the actor's **input key** isn't `postUrls`, or output fields differ,
     note it — see "Adjusting the Apify integration" below.

**Gate:** the actor returns non-empty post text for a known URL.

### 1.2 Anthropic
- Create an API key → `ANTHROPIC_API_KEY`. Model used: `claude-sonnet-4-5`.

### 1.3 Google Sheets (service account — NOT an API key)
1. GCP console → create a service account → create a **JSON key**.
2. Put the entire JSON (single line) into `GOOGLE_SERVICE_ACCOUNT_JSON`.
3. Create the target Sheet; copy its id → `GOOGLE_SHEET_ID`
   (optional tab name → `GOOGLE_SHEET_TAB`, default `Sheet1`).
4. **Share the Sheet with the SA email** (`client_email` in the JSON,
   `…@…iam.gserviceaccount.com`) as **Editor**. Skipping this → 403 on write.

**Gate:** SA email has Editor access to the Sheet.

### 1.4 Internal callback secret
- Choose a strong random string. Set it **identically** in two places:
  - Worker side: `packages/infra/.env` → `INTERNAL_API_SECRET`
  - Trigger.dev project env → `INTERNAL_API_SECRET`
- Mismatch or unset → internal endpoints reject with 401 (fails closed).

### 1.5 Internal API URL
- `INTERNAL_API_URL` (Trigger env) = the Worker base URL **reachable from where
  the task runs**:
  - local `trigger dev` task → local Worker URL (e.g. `http://localhost:8787`).
  - deployed task → deployed Worker URL.
- The task appends the `/api-reference` prefix automatically; set only the base.

### Env placement summary

| Var | Worker (`packages/infra/.env`) | Trigger.dev project env |
|---|---|---|
| `INTERNAL_API_SECRET` | ✅ (identical) | ✅ (identical) |
| `TRIGGER_SECRET_KEY`, `CORS_ORIGIN`, D1 binding | ✅ | — |
| `APIFY_API_KEY`, `ANTHROPIC_API_KEY` | — | ✅ |
| `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB?` | — | ✅ |
| `INTERNAL_API_URL` | — | ✅ |
| `APIFY_LINKEDIN_POST_ACTOR_ID?` | — | ✅ (optional) |

> Trigger.dev task code does NOT read `packages/infra/.env` at runtime. Set
> task-side secrets in the Trigger.dev project env (dashboard or env sync).
> `trigger dev` does load `packages/infra/.env` locally via `trigger.config.ts`.

---

## Phase 2 — Database migration

The D1 table `auto_emailing` (incl. the 6 template columns from `0001`) must
exist in the environment under test.

### Remote (deployed) D1
```bash
bun run deploy   # adopts the existing remote D1, applies pending migration files, deploys Worker
```
Forward-only: it applies migration FILES, not a schema diff.

### Local (miniflare) D1
- `bun run dev` applies pending migrations to the local miniflare D1 on start.
- Confirm the **template columns** are present locally (they were added in
  `0001` after the first local run). If unsure, inspect via the batch-get probe
  in Phase 4.3, or recreate the local DB.

**Gate:** the target D1 has `auto_emailing` with all magnet-id and template columns.

---

## Phase 3 — Bring up the services

Pick ONE topology and use it consistently for the run.

### Topology A — Local
```bash
# terminal 1: Worker (alchemy dev) + tasks (trigger dev)
bun run dev
```
- Note the Worker URL alchemy prints → use as `BASE` below.
- Ensure `INTERNAL_API_URL` (Trigger env) points at that same local URL.

### Topology B — Deployed
```bash
bun run deploy             # Worker + remote D1
bun run deploy:background   # trigger deploy (tasks)
```
- `BASE` = deployed Worker URL. `INTERNAL_API_URL` = same base.

```bash
export BASE="http://localhost:8787"   # or the deployed Worker URL
export SECRET="<INTERNAL_API_SECRET>"
```

### 3.1 Liveness
```bash
curl -s "$BASE/"        # → "See /rpc and the appropiate route!"
```
**Gate:** Worker responds.

### 3.2 Internal auth wiring (no data needed)
Proves the secret path + reachability before involving Apify/AI.
```bash
# missing secret → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "$BASE/api-reference/automation/internal/post-cache/batch-get" \
  -H "content-type: application/json" \
  -d '{"originalPostUrls":["https://example.com"]}'        # expect 401

# correct secret → 200 with {"rows":[]}
curl -s -X POST \
  "$BASE/api-reference/automation/internal/post-cache/batch-get" \
  -H "content-type: application/json" \
  -H "x-internal-secret: $SECRET" \
  -d '{"originalPostUrls":["https://example.com"]}'         # expect {"rows":[]}
```
**Gate:** 401 without secret, 200 `{"rows":[]}` with secret. (If the task runs
remotely, run the second curl from a host matching the task's network so you
also validate `INTERNAL_API_URL` reachability.)

---

## Phase 4 — Functional tests (in order)

Use one real LinkedIn post URL for the whole phase; reuse it in the lead.

```bash
export POST_URL="https://www.linkedin.com/posts/<real-activity>"
```

### 4.1 Start scraping (happy path)
```bash
curl -s -X POST "$BASE/api-reference/automation/linkedin-scraping" \
  -H "content-type: application/json" \
  -d "{\"originalPostUrl\":\"$POST_URL\"}"
```
**Expect:** `{"status":"started","runId":"run_…"}`.

### 4.2 Watch the scrape-post run
- Trigger.dev dashboard (or `trigger dev` console logs) → `scrape-post` run.
- **Expect:** status SUCCEEDED. Logs show "Scraped LinkedIn post" (content
  length > 0) and "Selected lead magnet sequence" (3 ids).
- Common first-run failure: `No LinkedIn post content found` → Apify field/actor
  mismatch (Phase 1.1).

**Gate:** run SUCCEEDED.

### 4.3 Inspect the D1 row
```bash
curl -s -X POST \
  "$BASE/api-reference/automation/internal/post-cache/batch-get" \
  -H "content-type: application/json" \
  -H "x-internal-secret: $SECRET" \
  -d "{\"originalPostUrls\":[\"$POST_URL\"]}" | jq
```
**Expect** one row with:
- `scraped: true`
- `postContent` non-empty, `posterName` set (or null if the post had none)
- `targetedLeadMagnetId`, `followUpOneLeadMagnetId`, `followUpTwoLeadMagnetId` set + distinct
- all 6 template fields (`email1Subject/Body`, `followUp1Subject/Body`,
  `followUp2Subject/Body`) non-null, each body containing `${firstName}`.

(Deployed alt: `wrangler d1 execute <db-name> --remote --command "SELECT scraped, targeted_lead_magnet_id, email1_subject FROM auto_emailing"`.)

**Gate:** row complete.

### 4.4 Cache hit (idempotency of scraping)
Re-run 4.1 with the same URL.
**Expect:** `{"status":"cached","originalPostUrl":…,"targetedLeadMagnetId":…,"followUpOneLeadMagnetId":…,"followUpTwoLeadMagnetId":…}`
and **no new** `scrape-post` run in the dashboard.

**Gate:** cached response, no new run.

### 4.5 Email generation (happy path)
Lead's `originalPostUrl` must be the same post (any casing/query — it's
normalized for lookup; the original string is what lands in the Sheet).
```bash
curl -s -X POST "$BASE/api-reference/automation/email-generation" \
  -H "content-type: application/json" \
  -d "{\"leads\":[{
    \"staffinClassification\":\"Recruiter\",
    \"companyName\":\"Acme Co\",
    \"companyUrl\":\"https://acme.example\",
    \"companyLinkedin\":\"https://linkedin.com/company/acme\",
    \"companyEmployees\":\"50-200\",
    \"companyIndustry\":\"Staffing\",
    \"companyDescription\":\"Acme does staffing.\",
    \"name\":\"Jane Doe\",
    \"country\":\"US\",
    \"originalComment\":\"Great post!\",
    \"originalPostUrl\":\"$POST_URL\",
    \"personalLinkedinUrl\":\"https://linkedin.com/in/janedoe\"
  }]}"
```
**Expect:** `{"runId":"run_…"}`.

### 4.6 Watch the email-generation run + Sheet
- Dashboard → `email-generation` run → SUCCEEDED; log "Appended email rows"
  with `rowsWritten: 1`. Task result: `{ sheetUrl, rowsWritten }`.
- Open the Sheet. **Expect** one new row, 27 columns in this order:
  `firstName, name, companyName, companyUrl, companyLinkedin, companyEmployees,
  companyIndustry, companyDescription, country, personalLinkedinUrl,
  originalComment, originalPostUrl, targetedLeadMagnet,
  targetedLeadMagnetDescription, targetedPainLine, followUpOneLeadMagnet,
  followUpOneDescription, followUpOnePainLine, followUpTwoLeadMagnet,
  followUpTwoDescription, followUpTwoPainLine, email1Subject, email1Body,
  followUp1Subject, followUp1Body, followUp2Subject, followUp2Body`.
- Verify `firstName` = `Jane`, every email body opens "Hey Jane," (no leftover
  `${firstName}`), magnet name/description/painLine populated.

**Gate:** exactly one correctly-rendered row.

### 4.7 Negative — email generation before scrape (must fail loudly)
Use a post URL that has NOT been scraped.
```bash
curl -s -X POST "$BASE/api-reference/automation/email-generation" \
  -H "content-type: application/json" \
  -d '{"leads":[{ … same shape …, "originalPostUrl":"https://www.linkedin.com/posts/UNSCRAPED" }]}'
```
**Expect:** endpoint returns a `runId`, then the `email-generation` run **FAILS**
with `Cannot generate emails; posts not scraped yet: <normalized url>`. No rows
written, no generic copy. This is correct behaviour, not a bug.

**Gate:** task fails with the exact URL list; Sheet unchanged.

### 4.8 CSV export
- File → Download → CSV. Confirm the 27 columns match the Instantly contract.

**Gate:** CSV has the expected header + the lead row.

---

## Phase 5 — Failure-mode drills (optional but recommended)

| Drill | How | Expected |
|---|---|---|
| Bad internal secret | call internal endpoint with wrong `x-internal-secret` | 401 |
| Apify empty/blocked | scrape a post the actor can't read | `scrape-post` fails `No LinkedIn post content found`; no D1 row written as scraped |
| Invalid magnet id from model | (rare) | `scrape-post` fails `Unknown lead magnet id(s)` / `must be distinct` |
| Google not shared | unshare the Sheet from the SA, run email-gen | task fails with Google 403 |
| Duplicate run | re-run 4.5 with same lead | **a second row is appended** (append is not idempotent; `maxAttempts:1` only prevents auto-retry dupes, not manual re-runs) |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `scrape-post`: `No LinkedIn post content found` | actor output fields differ / wrong actor / wrong input key | confirm actor (Phase 1.1); see "Adjusting the Apify integration" |
| internal call 401 | `INTERNAL_API_SECRET` unset/mismatched | set identically on Worker + Trigger |
| task can't reach internal API | `INTERNAL_API_URL` wrong/unreachable from task host | point at a URL reachable from the task runtime |
| Google 403 on append | Sheet not shared with SA email | share with `client_email` as Editor |
| email-gen fails "posts not scraped yet" unexpectedly | lead URL normalizes differently than scraped, or scrape incomplete | re-check the scraped URL / D1 row (4.3) |
| `db:push` errors about D1 HTTP params | not the migration path | use `bun run deploy` (Alchemy applies migrations), never `db:push` |
| local D1 missing template columns | `0001` not applied locally | re-run `bun run dev` / recreate local miniflare DB |

### Adjusting the Apify integration
If the chosen actor's contract differs from the defaults:
- Different actor → set `APIFY_LINKEDIN_POST_ACTOR_ID`.
- Different **input key** (not `postUrls`) → edit the `.call({ postUrls: [url] })`
  invocation in `packages/background/src/apify.ts` (`scrapeLinkedinPost`).
- Different **output fields** → extend `POST_CONTENT_FIELDS` / `POSTER_NAME_FIELDS`
  in the same file (the parser is isolated and pure for exactly this reason).

---

## Acceptance summary

The project passes when, in order:
1. Phase 0 static checks green.
2. `scrape-post` SUCCEEDS and writes a complete D1 row (4.2–4.3).
3. Re-scrape returns `cached` with no new run (4.4).
4. `email-generation` SUCCEEDS and writes one correct Sheet row per lead (4.5–4.6).
5. Email-gen before scrape FAILS loudly with the URL list (4.7).
6. CSV export matches the Instantly column contract (4.8).
