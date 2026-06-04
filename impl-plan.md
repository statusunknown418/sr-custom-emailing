# Implementation Plan — LinkedIn Lead Magnet Emailing Automation

Single source of truth for this feature. Folds in the handoff context. Execute the
stages **in order**; each stage has a concrete checkpoint that must pass before
starting the next.

## Goal

Automate outreach to LinkedIn lead-magnet post commenters:

1. Scrape a LinkedIn post's main content with Apify, run from a Trigger.dev task.
2. Use the AI SDK to **select** one **post-level** lead magnet sequence (3 distinct
   real magnets from the library, extracted from `linkedin-lead-magnet-SKILL.md.pdf`)
   **and author the 3-email template** for the post, all from the post content.
3. Cache the post scrape + selected magnet ids + the authored email template in
   Cloudflare D1.
4. Accept Clay leads, fetch the cached post template, and produce 1 main email + 2
   follow-ups per lead by substituting per-lead variables only.
5. Append Instantly-ready rows to a Google Sheet for CSV export.

## Core decisions

- **Apify** for LinkedIn scraping; scraping runs in a Trigger.dev task, never in the
  API request path.
- Only the **main LinkedIn post content** (plus poster name if available) is needed.
- **D1 is the cache / source of truth.** No separate KV (despite earlier KV wording).
  The `DB` D1 binding already exists in `packages/infra/alchemy.run.ts`.
- The AI SDK runs **inside** Trigger tasks.
- Lead magnet selection **and** template authoring are **per `originalPostUrl`, not
  per commenter.**
  - From the post content, the AI (Claude) **selects** 3 distinct real lead magnets
    from the library **and writes** the 3-email sequence (subjects + bodies) for the
    post.
  - Every commenter on the same post gets the **same** authored template.
  - Only per-lead variables change — `${firstName}` is the **only** placeholder; the
    poster name and post topic are baked into the template at authoring time.
- Store the 3 selected magnet ids **and the authored template** (6 fields: subject +
  body × email1/followUp1/followUp2) on the D1 row, so email generation is a pure
  string substitution and never re-runs the model. Magnet ids are kept to resolve the
  library name/description/painLine for the Sheet columns.
- Extract the PDF lead magnet library into repo code as typed data; deployed Trigger
  tasks cannot read the local `Downloads` path.
- **No automated tests.** Verification is type-checks (`bun run check-types`),
  lint (`bun x ultracite check`), and manual smoke. Keep helpers pure and parsers
  isolated for reviewability, but do not add unit/integration test files.

### Correction carried over from discussion

An earlier draft implied the template could vary per lead. It does **not**. Sequence
choice is post-level; per-lead substitution only fills values such as `${firstName}`.

## Architecture / data flow

```
startLinkedinScraping (API, public)
  -> D1 cache check (autoEmailing by normalized URL)
  -> if not scraped: insert pending row + trigger scrape-post task
       scrape-post task:
         Apify scrape -> parse main post text + poster name
         -> AI SDK (Claude) selects 3 distinct magnet ids + authors the 3-email template
         -> POST internal API post-cache/update -> writes D1 row
            (magnet ids + 6 template fields, scraped=true)

startEmailGeneration (API, public)
  -> trigger email-generation task
       email-generation task:
         normalize + group leads by originalPostUrl
         -> POST internal API post-cache/batch-get -> D1 rows (incl. stored template)
         -> fail if any URL missing/not scraped
         -> per lead: substitute ${firstName} into the stored template (no model call)
         -> append rows to Google Sheet
```

Trigger tasks have no Worker D1 binding, so all D1 access from tasks goes through
protected **internal API endpoints** (`x-internal-secret` header).

## Environment & secrets

No secret values are provided yet. Do not invent any. Wire reads from env; supply
values at deploy time.

### API Worker (`packages/infra/alchemy.run.ts` bindings)

- `TRIGGER_SECRET_KEY` (present)
- `CORS_ORIGIN` (present)
- `DB` D1 binding (present)
- `INTERNAL_API_SECRET` — new; validates internal callback auth.

### Trigger.dev

- `APIFY_API_KEY`
- AI SDK provider auth:
  - preferred: Vercel AI Gateway / OIDC if the project supports it
  - fallback: `ANTHROPIC_API_KEY`
- Google Sheets auth:
  - `GOOGLE_SERVICE_ACCOUNT_JSON`
  - `GOOGLE_SHEET_ID`
  - `GOOGLE_SHEET_TAB` (optional, default `Sheet1`)
- Internal API access:
  - `INTERNAL_API_URL`
  - `INTERNAL_API_SECRET`

---

# Stages

## Stage 0 — Dependencies & workspace prep

Add to `packages/background/package.json`:

- `ai`
- `@ai-sdk/anthropic`
- `apify-client`
- `googleapis`

Optionally pin versions in the root workspace `catalog`.

Run `bun install`.

**Checkpoint:** `bun install` clean; `bun run check-types` passes at baseline.

## Stage 1 — Database schema & migration

Add `packages/db/src/schema/auto-emailing.ts`.

Table `autoEmailing`:

- `id` integer primary key autoincrement
- `originalPostUrl` text unique not null
- `targetedLeadMagnetId` text nullable
- `followUpOneLeadMagnetId` text nullable
- `followUpTwoLeadMagnetId` text nullable
- `scraped` integer boolean default false not null
- `postContent` text nullable
- `posterName` text nullable
- `email1Subject` text nullable
- `email1Body` text nullable
- `followUp1Subject` text nullable
- `followUp1Body` text nullable
- `followUp2Subject` text nullable
- `followUp2Body` text nullable
- `createdAt` text default current timestamp not null
- `updatedAt` text default current timestamp not null

Export it from `packages/db/src/schema/index.ts`. Generate the migration with
`bun run db:generate`.

**Checkpoint:** migration file written under `packages/db/src/migrations`;
`bun run check-types` passes.

## Stage 2 — Lead magnet library (typed data)

Add `packages/background/src/lead-magnets.ts`. Convert the PDF lead magnet table into
a typed const list:

```ts
export interface LeadMagnet {
  id: string;
  category: string;
  leadMagnet: string;
  postLabel: string;
  description: string;
  painLine: string;
}
```

Rules:

- IDs stable, lowercase kebab-case.
- AI outputs **only** IDs.
- Provide a lookup helper (`getLeadMagnetById`) and a distinct-validation helper.
- Primary, follow-up 1, follow-up 2 IDs must be distinct and must all exist.

**Checkpoint:** `bun run check-types` passes; library + helpers resolve and type-check.

## Stage 3 — Pure helpers

Add small, pure helpers under `packages/background/src/`:

- `url.ts` — `normalizePostUrl(url: string): string`
- `names.ts` — `getFirstName(name: string): string`
- `emails.ts` — `applyLeadVariables(template: EmailSequence, vars: { firstName: string }): EmailSequence`

Keep these functions pure (no I/O).

### Email substitution rules (post-level template, per-lead vars only)

The 3-email template is **authored once per post by the model** (Stage 4) and stored
on the D1 row. `applyLeadVariables` only replaces `${firstName}` in each subject and
body — it does **not** assemble copy from magnet fields. `${firstName}` is the only
placeholder; the poster name and topic are already baked into the stored template.

`emails.ts` exports: `Email { subject; body }`, `EmailSequence { email1; followUp1;
followUp2 }`, and `FIRST_NAME_PLACEHOLDER` (the literal `${firstName}`, built from
parts to satisfy biome `noTemplateCurlyInString`).

**Checkpoint:** `bun run check-types` passes; `applyLeadVariables` substitutes
`${firstName}` across all three emails.

## Stage 4 — Integration helpers

Add:

- `lead-magnet-selection.ts`
  - `generatePostEmailSequence(input: { postContent: string; posterName?: string | null }): Promise<GeneratedPostSequence>`
  - AI SDK structured output (Claude **selects** magnets **and authors** the template):

    ```ts
    {
      targetedLeadMagnetId: string;
      followUpOneLeadMagnetId: string;
      followUpTwoLeadMagnetId: string;
      email1Subject: string;
      email1Body: string;
      followUp1Subject: string;
      followUp1Body: string;
      followUp2Subject: string;
      followUp2Body: string;
      reason: string;
    }
    ```

  - Returns `GeneratedPostSequence` = the 3 magnet ids + `template: EmailSequence` +
    `reason`.
  - After the model returns: validate the ids exist and are distinct (Stage 2 helper),
    and validate every template field is non-empty and each body contains
    `${firstName}`.
- `google-sheets.ts`
  - `appendEmailRows(rows: EmailSheetRow[]): Promise<{ sheetUrl: string; rowsWritten: number }>`
  - Uses `googleapis` with `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_SHEET_ID` /
    `GOOGLE_SHEET_TAB`.

### Template authoring guide (given to the model as the structure to follow)

`${firstName}` is the only placeholder; bake the poster name + topic directly.

- email1: reference their comment ("Saw your comment on <poster>'s post about
  <topic>." — drop the name if no poster), pitch the **targeted** magnet, soft CTA
  ("Want to check it out?"). Subject like `saw your linkedin comment` or
  `<poster>'s <topic>`.
- followUp1: subject `one more thing`; "We also built this one — <second magnet
  pitch>."; CTA "Want both?".
- followUp2: subject `last thing`; "Last one — <third magnet pitch>."; CTA
  "Should I send it over?".

**Checkpoint:** types compile; generation output schema, post-model id validation,
and template non-empty / `${firstName}` checks in place.

## Stage 5 — Background schemas & types

Update `packages/background/src/types.ts` with:

- `startLinkedinScrapingPayloadSchema`
- `scrapePostPayloadSchema`
- `clayLeadSchema`
- `emailGenerationPayloadSchema`
- internal-endpoint contract schemas (kept here, not in the API package, so the
  Stage 7 task and Stage 6 endpoint share them without an api→background cycle):
  - `postCacheUpdatePayloadSchema` — `originalPostUrl`, `postContent`, `posterName`
    (nullish), the 3 magnet ids, **and the 6 template fields** (`email1Subject`,
    `email1Body`, `followUp1Subject`, `followUp1Body`, `followUp2Subject`,
    `followUp2Body`).
  - `postCacheBatchGetPayloadSchema` — `originalPostUrls` (`.min(1)`).
  - `postCacheRowSchema` (+ `PostCacheRow`) — the cached row incl. the 6 template
    fields (nullable).
- inferred TS types

`ClayLead` fields:

```ts
{
  staffinClassification: string;
  companyName: string;
  companyUrl: string;
  companyLinkedin: string;
  companyEmployees: string;
  companyIndustry: string;
  companyDescription: string;
  name: string;
  country: string;
  originalComment: string;
  originalPostUrl: string;
  personalLinkedinUrl: string;
}
```

**Checkpoint:** `bun run check-types` passes; `clayLeadSchema` rejects empty `leads`
and missing fields by construction (`.min(1)` / required fields).

## Stage 6 — Internal API callback endpoints

Trigger tasks have no Worker D1 binding, so add protected internal endpoints in the
API package (the task→D1 contract the next stage depends on):

- `POST /automation/internal/post-cache/update` — writes scrape + selection + the
  authored template to D1 (`postContent`, `posterName`, the 3 magnet ids, the 6
  template fields, `scraped=true`, bump `updatedAt`).
- `POST /automation/internal/post-cache/batch-get` — returns rows by normalized URLs
  for email generation.

Auth:

- Header `x-internal-secret`, compared against `INTERNAL_API_SECRET`.
- Reject with 401 when missing/mismatched.

(Alternative considered: call the Cloudflare D1 HTTP API directly from Trigger. Needs
Cloudflare account/database/token env. Internal API is simpler because the Worker
already has the D1 binding.)

**Checkpoint:** endpoints compile and are registered in `routers/index.ts`; auth
guard rejects bad/missing secret.

## Stage 7 — Trigger tasks

Add tasks under `packages/background/src/trigger/` and export them from
`packages/background/src/trigger/index.ts`.

### `scrape-post.task.ts` (task id `scrape-post`)

Payload: `{ originalPostUrl: string }`

Flow:

1. Scrape the LinkedIn post with Apify (`APIFY_API_KEY`).
2. Extract only the main post content plus poster name if available.
3. AI SDK structured output → select 3 distinct magnets **and author the 3-email
   template** for the post (`generatePostEmailSequence`, pass `postContent` +
   `posterName`).
4. Validate ids exist + distinct, every template field non-empty, each body has
   `${firstName}` (done inside `generatePostEmailSequence`).
5. Update the D1 row via `post-cache/update` internal endpoint (magnet ids + 6
   template fields). Send `x-internal-secret`; call the `/api-reference`-prefixed URL.
6. Return scraped post + selected sequence + template metadata.

**Apify parser acceptance:**

- Prefer an actor that returns the main LinkedIn post text for a URL.
- Probe known fields explicitly: `text`, `content`, `postText`, `commentary`,
  `description`.
- **Fail the task** if no non-empty post content is found (never proceed with empty).
- Isolate the parser as a small pure function so the field-probing logic stays
  reviewable and the actor output shape is documented in one place.

### `email-generation.task.ts` (task id `email-generation`)

Payload: `{ leads: ClayLead[] }`

Flow:

1. Normalize each `originalPostUrl`.
2. Group leads by normalized `originalPostUrl`.
3. Fetch matching D1 rows via `post-cache/batch-get`.
4. If any URL is missing or `scraped=false`, fail with the exact URL list.
5. For each lead: derive `firstName` and apply it to the **stored template** via
   `applyLeadVariables` (no model call). Resolve the stored magnet ids against the
   library for the Sheet's magnet name/description/painLine columns.
6. Append rows to the Google Sheet (`appendEmailRows`).
7. Return `{ sheetUrl: string; rowsWritten: number }`.

**Checkpoint:** `bun run check-types` passes; both tasks compile and are exported.

## Stage 8 — Background public trigger wrappers & exports

Update `packages/background/src/index.ts`:

- `triggerScrapePost(payload)` → `tasks.trigger<typeof scrapePost>("scrape-post", …)`
- `triggerEmailGeneration(payload)` → `tasks.trigger<typeof emailGeneration>("email-generation", …)`
- Re-export the Stage 5 schemas and inferred types.

Each wrapper parses its payload schema before triggering (mirror the existing
`triggerStartBackgroundProcessing` pattern).

**Checkpoint:** API package can import the wrappers/schemas; `bun run check-types`
passes.

## Stage 9 — Public API endpoints

File: `packages/api/src/routers/automation.ts` (extend existing router; register in
`routers/index.ts`).

### `startLinkedinScraping` — `POST /automation/linkedin-scraping`

Input: `{ originalPostUrl: string }`

Flow:

1. Normalize `originalPostUrl`.
2. Query D1 `autoEmailing` by normalized URL.
3. If a row exists with `scraped=true` and non-empty `postContent`, return cached:

   ```ts
   {
     status: "cached";
     originalPostUrl: string;
     targetedLeadMagnetId: string;
     followUpOneLeadMagnetId: string;
     followUpTwoLeadMagnetId: string;
   }
   ```

4. Else insert a pending row if missing.
5. Trigger the `scrape-post` task.
6. Return `{ status: "started"; runId: string }`.

### `startEmailGeneration` — `POST /automation/email-generation`

Input: `{ leads: ClayLead[] }`

Flow:

1. Validate `leads` non-empty.
2. Normalize each `originalPostUrl`.
3. Trigger the `email-generation` task.
4. Return `{ runId: string }`.

**Checkpoint:** routes compile and are registered; `bun run check-types` passes.

## Stage 10 — Google Sheet output (contract)

Append one row per lead. Column order:

- `email`
- `firstName`
- `name`
- `companyName`
- `companyUrl`
- `companyLinkedin`
- `companyEmployees`
- `companyIndustry`
- `companyDescription`
- `country`
- `personalLinkedinUrl`
- `originalComment`
- `originalPostUrl`
- `targetedLeadMagnet`
- `targetedLeadMagnetDescription`
- `targetedPainLine`
- `followUpOneLeadMagnet`
- `followUpOneDescription`
- `followUpOnePainLine`
- `followUpTwoLeadMagnet`
- `followUpTwoDescription`
- `followUpTwoPainLine`
- `email1Subject`
- `email1Body`
- `followUp1Subject`
- `followUp1Body`
- `followUp2Subject`
- `followUp2Body`

This Sheet exports to CSV for upload to Instantly. `email` is the recipient
address (required by Instantly; supplied by Clay) and leads the columns.
`appendEmailRows` writes this list as a header row when the tab is empty so
Instantly can map columns and resolve `{{column}}` custom variables by name.

(Implemented by `appendEmailRows` in Stage 4 and consumed by the Stage 7
email-generation task; listed here as the stable output contract.)

## Stage 11 — Verification

### Static checks
```bash
bun install
bun run db:generate
bun run check-types
bun x ultracite check
```

### Manual smoke

1. Call `startLinkedinScraping` with a known LinkedIn post URL.
2. Confirm the task run completes.
3. Confirm the D1 row: `scraped=true`, `postContent` non-empty, 3 magnet IDs set.
4. Call `startEmailGeneration` with one Clay lead using the same URL.
5. Confirm the Google Sheet has one row with 3 emails.
6. Export the Sheet CSV and verify Instantly columns are present.

---

## Known risks

- Apify actor output fields may change. Mitigate with explicit multi-field probing
  in an isolated parser function that fails loudly on empty content.
- LinkedIn scraping can fail or return partial content. The task must fail loudly if
  main post content is missing.
- The Google service account must have edit access to the target Sheet.
- The AI can choose invalid IDs despite the schema. Validate IDs after model output.
- Missing scrape before email generation must fail, not silently generate generic copy.

## Suggested skills

- `ai-sdk` — AI SDK structured output (Stage 4 / Stage 7).
- `trigger-tasks` — Trigger.dev task authoring (Stage 7).
- `hono` / oRPC context — API plumbing (Stages 6, 9).
- `native-data-fetching` — Apify / internal API / Google API calls.
- `ultracite` — run before lint/format fixes.
