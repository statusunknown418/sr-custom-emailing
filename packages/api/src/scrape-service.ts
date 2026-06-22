import {
	triggerCommentTrackingScrape,
	triggerHarvestCommenters,
	triggerSomeoneElseScrape,
} from "@sr-custom-emailing/background";
import { normalizePostUrl } from "@sr-custom-emailing/background/url";
import { getPostByUrl, insertPendingPost } from "@sr-custom-emailing/db";

/** Which flow a scrape belongs to (mirrors the D1 `source` discriminator). */
export type ScrapeFlow = "comment_tracking" | "someone_else";

/** A post already scraped+authored for this flow; no task is enqueued. */
export interface ScrapeCachedResult {
	commentersRunId: string;
	followUpOneLeadMagnetId: string | null;
	followUpTwoLeadMagnetId: string | null;
	originalPostUrl: string;
	posterLeadMagnet: string | null;
	status: "cached";
	targetedLeadMagnetId: string | null;
}

/** A scrape task was enqueued for this post. */
export interface ScrapeStartedResult {
	commentersRunId: string;
	originalPostUrl: string;
	runId: string;
	status: "started";
}

export type ScrapeResult = ScrapeCachedResult | ScrapeStartedResult;

/**
 * Start (or short-circuit) a scrape for one post. Shared by the public flow
 * endpoints and the Discord interactions handler so the cache-hit + pending-row
 * + enqueue logic lives in one place.
 *
 * Returns `cached` (with the selected magnet ids) when the post is already
 * scraped+authored for this flow, otherwise inserts a pending row (when no row
 * exists) and enqueues the flow's scrape task. The raw URL is passed to the task
 * for scraping; the normalized URL is the cache key.
 */
export async function runScrape(
	flow: ScrapeFlow,
	rawUrl: string
): Promise<ScrapeResult> {
	const originalPostUrl = normalizePostUrl(rawUrl);
	const existing = await getPostByUrl(originalPostUrl);

	// Harvest this post's commenters (Apify -> webhook -> Clay) on every call,
	// including cache hits: the per-post copy is cached, but the commenters are
	// the per-run audience and must be re-harvested each time.
	const commentersHandle = await triggerHarvestCommenters({
		flow,
		originalPostUrl: rawUrl,
	});
	const commentersRunId = commentersHandle.id;

	const cached =
		flow === "comment_tracking"
			? Boolean(
					existing?.scraped &&
						existing.source === "comment_tracking" &&
						existing.dm1Body &&
						existing.dm2Body
				)
			: Boolean(
					existing?.scraped &&
						existing.source === "someone_else" &&
						existing.postContent &&
						existing.email1Body &&
						existing.followUp1Body &&
						existing.followUp2Body
				);

	if (existing && cached) {
		return {
			status: "cached",
			commentersRunId,
			originalPostUrl,
			posterLeadMagnet: existing.posterLeadMagnet,
			targetedLeadMagnetId: existing.targetedLeadMagnetId,
			followUpOneLeadMagnetId: existing.followUpOneLeadMagnetId,
			followUpTwoLeadMagnetId: existing.followUpTwoLeadMagnetId,
		};
	}

	if (!existing) {
		await insertPendingPost(originalPostUrl, flow);
	}

	const handle =
		flow === "comment_tracking"
			? await triggerCommentTrackingScrape({ originalPostUrl: rawUrl })
			: await triggerSomeoneElseScrape({ originalPostUrl: rawUrl });

	return {
		commentersRunId,
		originalPostUrl,
		runId: handle.id,
		status: "started",
	};
}
