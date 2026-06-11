import { requireEnv } from "./process-env";

/**
 * Default Apify actor used to fetch a single LinkedIn post by URL. Override with
 * `APIFY_LINKEDIN_POST_ACTOR_ID` to point at a different actor; the parser below
 * tolerates different output shapes, but the actor must accept a `post_urls`
 * array input and emit the post text at `post.text` or one of {@link POST_CONTENT_FIELDS}.
 */
const DEFAULT_LINKEDIN_POST_ACTOR_ID = "apimaestro/linkedin-post-detail";

/**
 * Default Apify actor used to harvest the commenters on a LinkedIn post.
 * Override with `APIFY_LINKEDIN_COMMENTS_ACTOR_ID`. The actor accepts a `posts`
 * array input and emits one root comment per dataset item with the commenter at
 * `actor.{name,linkedinUrl}` and the text at `commentary`.
 */
const DEFAULT_LINKEDIN_COMMENTS_ACTOR_ID = "harvestapi/linkedin-post-comments";

/** Default cap on commenters harvested per post (override `APIFY_COMMENTS_MAX_ITEMS`). */
const COMMENTS_DEFAULT_MAX_ITEMS = 1000;

const APIFY_API_BASE_URL = "https://api.apify.com/v2";

/**
 * Dataset-item fields probed for the main post text, in priority order. The
 * default actor emits `post.text`; other LinkedIn scrapers often emit the same
 * values at the dataset item root.
 */
const POST_CONTENT_FIELDS = [
	"text",
	"content",
	"postText",
	"commentary",
	"description",
] as const;

/** Top-level dataset-item fields probed for the poster's display name. */
const POSTER_NAME_FIELDS = [
	"authorName",
	"authorFullName",
	"posterName",
	"fullName",
	"name",
] as const;

/** Nested `author`-object fields probed for the poster's display name. */
const AUTHOR_OBJECT_NAME_FIELDS = ["name", "fullName", "fullname"] as const;

/** The main content of a scraped LinkedIn post plus the poster name if found. */
export interface ParsedLinkedinPost {
	postContent: string;
	posterName: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return null;
}

function firstNonEmptyString(
	record: Record<string, unknown>,
	keys: readonly string[]
): string | null {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string") {
			const trimmed = value.trim();
			if (trimmed !== "") {
				return trimmed;
			}
		}
	}
	return null;
}

function extractPostContent(record: Record<string, unknown>): string | null {
	const direct = firstNonEmptyString(record, POST_CONTENT_FIELDS);
	if (direct) {
		return direct;
	}

	const post = asRecord(record.post);
	if (post) {
		return firstNonEmptyString(post, POST_CONTENT_FIELDS);
	}
	return null;
}

function extractPosterName(record: Record<string, unknown>): string | null {
	const direct = firstNonEmptyString(record, POSTER_NAME_FIELDS);
	if (direct) {
		return direct;
	}

	const author = asRecord(record.author);
	if (author) {
		return firstNonEmptyString(author, AUTHOR_OBJECT_NAME_FIELDS);
	}
	return null;
}

function toApifyActorPath(actorId: string): string {
	return encodeURIComponent(actorId.replace("/", "~"));
}

async function readApifyError(response: Response): Promise<string> {
	const body = await response.text();
	if (body) {
		return `Apify request failed (${response.status} ${response.statusText}): ${body}`;
	}
	return `Apify request failed (${response.status} ${response.statusText})`;
}

async function runApifyActorSync(
	token: string,
	actorId: string,
	originalPostUrl: string
): Promise<unknown[]> {
	const actorPath = toApifyActorPath(actorId);
	const response = await fetch(
		`${APIFY_API_BASE_URL}/acts/${actorPath}/run-sync-get-dataset-items?format=json`,
		{
			body: JSON.stringify({ post_urls: [originalPostUrl] }),
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		}
	);

	if (!response.ok) {
		throw new Error(await readApifyError(response));
	}

	const items: unknown = await response.json();
	if (!Array.isArray(items)) {
		throw new Error("Apify returned a non-array dataset response");
	}

	return items;
}

/**
 * Pure parser for the Apify dataset items returned for a LinkedIn post. Isolated
 * from the network call so the field-probing logic stays reviewable and the
 * actor output contract is documented in one place. Probes the first
 * object-shaped item for post text and the poster name.
 *
 * @param items - Raw dataset items from the actor run.
 * @returns The main post content and poster name (if found).
 * @throws If there is no usable item, the item reports an actor error, or no
 *   non-empty post content is present (the task must never proceed with empty
 *   content).
 */
export function parseLinkedinPost(items: unknown[]): ParsedLinkedinPost {
	const record = asRecord(items.find((item) => asRecord(item) !== null));
	if (!record) {
		throw new Error("Apify returned no usable items for the LinkedIn post");
	}

	if (record.error) {
		const message = record.message ?? record.error;
		throw new Error(`Apify actor reported an error: ${String(message)}`);
	}

	const postContent = extractPostContent(record);
	if (!postContent) {
		throw new Error(
			`No LinkedIn post content found. Probed fields: ${POST_CONTENT_FIELDS.join(", ")}, post.${POST_CONTENT_FIELDS.join(", post.")}`
		);
	}

	return { postContent, posterName: extractPosterName(record) };
}

/**
 * Scrape a single LinkedIn post via Apify and parse out the main content and
 * poster name. Runs inside the scrape Trigger tasks (not the Worker), so
 * `APIFY_API_KEY` is read from `process.env`.
 *
 * @param originalPostUrl - The LinkedIn post URL to scrape.
 * @returns The parsed post content and poster name.
 * @throws If `APIFY_API_KEY` is missing or the actor returns no post content.
 */
export async function scrapeLinkedinPost(
	originalPostUrl: string
): Promise<ParsedLinkedinPost> {
	const token = requireEnv("APIFY_API_KEY");
	const actorId =
		process.env.APIFY_LINKEDIN_POST_ACTOR_ID ?? DEFAULT_LINKEDIN_POST_ACTOR_ID;

	return parseLinkedinPost(
		await runApifyActorSync(token, actorId, originalPostUrl)
	);
}

/** Top-level dataset-item fields probed for a comment's text, in priority order. */
const COMMENT_TEXT_FIELDS = ["commentary", "comment", "text"] as const;

/** Nested `actor`-object fields probed for the commenter's profile URL. */
const COMMENTER_URL_FIELDS = ["linkedinUrl", "url", "profileUrl"] as const;

/** A single LinkedIn commenter parsed from the comments dataset. */
export interface Commenter {
	comment: string;
	name: string | null;
	profileUrl: string;
}

/**
 * Pure parser for the LinkedIn post-comments dataset. Each item is a root
 * comment whose nested `actor` carries the commenter's name and profile URL.
 * Isolated from the network call so the field-probing stays reviewable. Drops
 * items without a commenter profile URL (cannot be enriched or contacted) and
 * de-duplicates repeat commenters by profile URL, keeping the first comment.
 *
 * @param items - Raw dataset items from the comments actor run.
 * @returns One {@link Commenter} per distinct profile URL.
 */
export function parseCommenters(items: unknown[]): Commenter[] {
	const byProfile = new Map<string, Commenter>();
	for (const item of items) {
		const record = asRecord(item);
		if (!record) {
			continue;
		}
		const actor = asRecord(record.actor);
		const profileUrl = actor
			? firstNonEmptyString(actor, COMMENTER_URL_FIELDS)
			: null;
		if (!profileUrl) {
			continue;
		}
		const key = profileUrl.toLowerCase();
		if (byProfile.has(key)) {
			continue;
		}
		byProfile.set(key, {
			comment: firstNonEmptyString(record, COMMENT_TEXT_FIELDS) ?? "",
			name: actor
				? firstNonEmptyString(actor, AUTHOR_OBJECT_NAME_FIELDS)
				: null,
			profileUrl,
		});
	}
	return [...byProfile.values()];
}

/**
 * Start an asynchronous Apify run of the LinkedIn post-comments actor for one
 * post, attaching an ad-hoc webhook that fires on every terminal run event. The
 * run is NOT awaited to completion: Apify POSTs `webhookUrl` when it finishes,
 * carrying the run's dataset id. Runs inside the harvest Trigger task (not the
 * Worker), so `APIFY_API_KEY` is read from `process.env`.
 *
 * @param originalPostUrl - The LinkedIn post URL to harvest commenters from.
 * @param webhookUrl - Our endpoint Apify calls on a terminal run event; carries
 *   the flow flag in its path so the completion can be routed.
 * @param webhookSecret - Shared secret sent as the `x-apify-webhook-secret`
 *   header so the receiver can authenticate the callback.
 * @returns The started run id (for logging/observability).
 * @throws If `APIFY_API_KEY` is missing or the run fails to start.
 */
export async function startCommenterScrape(
	originalPostUrl: string,
	webhookUrl: string,
	webhookSecret: string
): Promise<string> {
	const token = requireEnv("APIFY_API_KEY");
	const actorId =
		process.env.APIFY_LINKEDIN_COMMENTS_ACTOR_ID ??
		DEFAULT_LINKEDIN_COMMENTS_ACTOR_ID;
	const maxItemsOverride = Number.parseInt(
		process.env.APIFY_COMMENTS_MAX_ITEMS ?? "",
		10
	);
	const maxItems =
		Number.isFinite(maxItemsOverride) && maxItemsOverride > 0
			? maxItemsOverride
			: COMMENTS_DEFAULT_MAX_ITEMS;

	const webhooks = Buffer.from(
		JSON.stringify([
			{
				eventTypes: [
					"ACTOR.RUN.SUCCEEDED",
					"ACTOR.RUN.FAILED",
					"ACTOR.RUN.ABORTED",
					"ACTOR.RUN.TIMED_OUT",
				],
				headersTemplate: JSON.stringify({
					"x-apify-webhook-secret": webhookSecret,
				}),
				requestUrl: webhookUrl,
			},
		])
	).toString("base64");

	const actorPath = toApifyActorPath(actorId);
	const response = await fetch(
		`${APIFY_API_BASE_URL}/acts/${actorPath}/runs?webhooks=${encodeURIComponent(webhooks)}`,
		{
			body: JSON.stringify({
				maxItems,
				posts: [originalPostUrl],
				scrapeReplies: false,
			}),
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		}
	);

	if (!response.ok) {
		throw new Error(await readApifyError(response));
	}

	const body = asRecord(await response.json());
	const data = body ? asRecord(body.data) : null;
	const runId = data && typeof data.id === "string" ? data.id : "";
	if (!runId) {
		throw new Error("Apify run start returned no run id");
	}
	return runId;
}

/**
 * Fetch all dataset items for a finished Apify run by dataset id. Runs inside
 * the forward Trigger task (not the Worker), so `APIFY_API_KEY` is read from
 * `process.env`.
 *
 * @param datasetId - The run's default dataset id (from the Apify webhook).
 * @returns The raw dataset items.
 * @throws If `APIFY_API_KEY` is missing, the request fails, or the response is
 *   not an array.
 */
export async function fetchApifyDatasetItems(
	datasetId: string
): Promise<unknown[]> {
	const token = requireEnv("APIFY_API_KEY");
	const response = await fetch(
		`${APIFY_API_BASE_URL}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json`,
		{ headers: { Authorization: `Bearer ${token}` } }
	);

	if (!response.ok) {
		throw new Error(await readApifyError(response));
	}

	const items: unknown = await response.json();
	if (!Array.isArray(items)) {
		throw new Error("Apify returned a non-array dataset response");
	}
	return items;
}
