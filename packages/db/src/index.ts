import { env } from "@sr-custom-emailing/env/server";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema";
import { type AutoEmailing, autoEmailing } from "./schema";

export function createDb() {
	return drizzle(env.DB, { schema });
}

/** Fields written when a post finishes scraping, selection, and authoring. */
export interface UpsertScrapedPostInput {
	email1Body: string;
	email1Subject: string;
	followUp1Body: string;
	followUp1Subject: string;
	followUp2Body: string;
	followUp2Subject: string;
	followUpOneLeadMagnetId: string;
	followUpTwoLeadMagnetId: string;
	originalPostUrl: string;
	postContent: string;
	posterName: string | null;
	targetedLeadMagnetId: string;
}

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
		postContent: input.postContent,
		posterName: input.posterName,
		targetedLeadMagnetId: input.targetedLeadMagnetId,
		followUpOneLeadMagnetId: input.followUpOneLeadMagnetId,
		followUpTwoLeadMagnetId: input.followUpTwoLeadMagnetId,
		email1Subject: input.email1Subject,
		email1Body: input.email1Body,
		followUp1Subject: input.followUp1Subject,
		followUp1Body: input.followUp1Body,
		followUp2Subject: input.followUp2Subject,
		followUp2Body: input.followUp2Body,
		scraped: true,
		updatedAt: new Date().toISOString(),
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
