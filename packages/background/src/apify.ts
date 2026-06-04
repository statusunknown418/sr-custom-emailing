import { requireEnv } from "./process-env";

/**
 * Default Apify actor used to fetch a single LinkedIn post by URL. Override with
 * `APIFY_LINKEDIN_POST_ACTOR_ID` to point at a different actor; the parser below
 * tolerates different output shapes, but the actor must accept a `post_urls`
 * array input and emit the post text at `post.text` or one of {@link POST_CONTENT_FIELDS}.
 */
const DEFAULT_LINKEDIN_POST_ACTOR_ID = "apimaestro/linkedin-post-detail";

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
 * poster name. Runs inside the `scrape-post` Trigger task (not the Worker), so
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
