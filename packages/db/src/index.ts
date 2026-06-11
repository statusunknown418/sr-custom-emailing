import { env } from "@sr-custom-emailing/env/server";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema";
import { type AutoEmailing, autoEmailing } from "./schema";

export function createDb() {
	return drizzle(env.DB, { schema });
}

/** Scrape + magnet-selection fields common to both cache-update variants. */
interface UpsertScrapedPostBase {
	followUpOneLeadMagnetId: string;
	followUpTwoLeadMagnetId: string;
	originalPostUrl: string;
	postContent: string;
	posterLeadMagnet: string;
	posterName: string | null;
	targetedLeadMagnetId: string;
}

/** Comment-tracking post: the 3 LinkedIn DM bodies are authoritative. */
export interface UpsertCommentTrackingPostInput extends UpsertScrapedPostBase {
	dm1Body: string;
	dm2Body: string;
	dm3Body: string;
	source: "comment_tracking";
}

/** Someone-else post: the 3-email sequence is authoritative (pushed to Instantly). */
export interface UpsertSomeoneElsePostInput extends UpsertScrapedPostBase {
	email1Body: string;
	email1Subject: string;
	followUp1Body: string;
	followUp1Subject: string;
	followUp2Body: string;
	followUp2Subject: string;
	source: "someone_else";
}

/** Fields written when a post finishes scraping, selection, and authoring. */
export type UpsertScrapedPostInput =
	| UpsertCommentTrackingPostInput
	| UpsertSomeoneElsePostInput;

/**
 * Insert or update the cached post row for `originalPostUrl`, marking it
 * `scraped` and bumping `updatedAt`. The caller is responsible for passing an
 * already-normalized URL (the unique cache key).
 */
export async function upsertScrapedPost(
	input: UpsertScrapedPostInput
): Promise<void> {
	const db = createDb();
	const mutable = {
		source: input.source,
		postContent: input.postContent,
		posterName: input.posterName,
		posterLeadMagnet: input.posterLeadMagnet,
		targetedLeadMagnetId: input.targetedLeadMagnetId,
		followUpOneLeadMagnetId: input.followUpOneLeadMagnetId,
		followUpTwoLeadMagnetId: input.followUpTwoLeadMagnetId,
		scraped: true,
		updatedAt: new Date().toISOString(),
		...(input.source === "comment_tracking"
			? {
					dm1Body: input.dm1Body,
					dm2Body: input.dm2Body,
					dm3Body: input.dm3Body,
				}
			: {
					email1Subject: input.email1Subject,
					email1Body: input.email1Body,
					followUp1Subject: input.followUp1Subject,
					followUp1Body: input.followUp1Body,
					followUp2Subject: input.followUp2Subject,
					followUp2Body: input.followUp2Body,
				}),
	};

	await db
		.insert(autoEmailing)
		.values({ originalPostUrl: input.originalPostUrl, ...mutable })
		.onConflictDoUpdate({
			target: autoEmailing.originalPostUrl,
			set: mutable,
		});
}

/**
 * Fetch cached post rows by their (normalized) `originalPostUrl`s. Returns only
 * the rows that exist; missing URLs are simply absent from the result.
 */
export async function getPostsByUrls(
	originalPostUrls: string[]
): Promise<AutoEmailing[]> {
	if (originalPostUrls.length === 0) {
		return [];
	}

	const db = createDb();
	const rows = await db
		.select()
		.from(autoEmailing)
		.where(inArray(autoEmailing.originalPostUrl, originalPostUrls));

	return rows;
}

/**
 * Fetch the single cached post row for a (normalized) `originalPostUrl`, or
 * `undefined` when no row exists yet.
 */
export async function getPostByUrl(
	originalPostUrl: string
): Promise<AutoEmailing | undefined> {
	const db = createDb();
	const [row] = await db
		.select()
		.from(autoEmailing)
		.where(eq(autoEmailing.originalPostUrl, originalPostUrl))
		.limit(1);

	return row;
}

/**
 * Insert a pending (unscraped) cache row for `originalPostUrl` if one does not
 * already exist. Idempotent: an existing row (pending or scraped) is left
 * untouched. The caller must pass an already-normalized URL.
 */
export async function insertPendingPost(
	originalPostUrl: string,
	source: "comment_tracking" | "someone_else"
): Promise<void> {
	const db = createDb();
	await db
		.insert(autoEmailing)
		.values({ originalPostUrl, source })
		.onConflictDoNothing({ target: autoEmailing.originalPostUrl });
}
