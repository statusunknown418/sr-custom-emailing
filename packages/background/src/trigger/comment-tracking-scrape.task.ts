import { logger, schemaTask } from "@trigger.dev/sdk";

import { scrapeLinkedinPost } from "../apify";
import { updatePostCache } from "../internal-api";
import { generatePostDmSequence } from "../lead-magnet-selection";
import { scrapePostPayloadSchema } from "../types";

/**
 * Comment-tracking flow: scrape one of OUR LinkedIn posts, select the post-level
 * lead magnet sequence, author the 2-message LinkedIn DM template, and persist
 * it to the D1 cache (`source = comment_tracking`).
 *
 * Flow: Apify scrape -> validate non-empty content -> Claude selects 3 distinct
 * magnets and writes DM 1; DM 2 is rendered from the selected magnet -> POST the
 * internal `post-cache/update` endpoint. Fails loudly at every step so a post is
 * never cached with empty content or an invalid selection.
 */
export const commentTrackingScrape = schemaTask({
	id: "comment-tracking-scrape",
	schema: scrapePostPayloadSchema,
	retry: {
		maxAttempts: 3,
		factor: 1.8,
		minTimeoutInMs: 1000,
		maxTimeoutInMs: 30_000,
	},
	run: async (payload) => {
		const { originalPostUrl } = payload;

		const post = await scrapeLinkedinPost(originalPostUrl);
		logger.info("Scraped LinkedIn post", {
			originalPostUrl,
			posterName: post.posterName,
			contentLength: post.postContent.length,
		});

		const sequence = await generatePostDmSequence({
			postContent: post.postContent,
			posterName: post.posterName,
		});
		logger.info("Authored DM sequence", {
			originalPostUrl,
			posterLeadMagnet: sequence.posterLeadMagnet,
			targetedLeadMagnetId: sequence.targetedLeadMagnetId,
			followUpOneLeadMagnetId: sequence.followUpOneLeadMagnetId,
			followUpTwoLeadMagnetId: sequence.followUpTwoLeadMagnetId,
		});

		await updatePostCache({
			source: "comment_tracking",
			originalPostUrl,
			postContent: post.postContent,
			posterName: post.posterName,
			posterLeadMagnet: sequence.posterLeadMagnet,
			targetedLeadMagnetId: sequence.targetedLeadMagnetId,
			followUpOneLeadMagnetId: sequence.followUpOneLeadMagnetId,
			followUpTwoLeadMagnetId: sequence.followUpTwoLeadMagnetId,
			dm1Body: sequence.sequence.dm1,
			dm2Body: sequence.sequence.dm2,
		});

		return {
			originalPostUrl,
			posterName: post.posterName,
			posterLeadMagnet: sequence.posterLeadMagnet,
			targetedLeadMagnetId: sequence.targetedLeadMagnetId,
			followUpOneLeadMagnetId: sequence.followUpOneLeadMagnetId,
			followUpTwoLeadMagnetId: sequence.followUpTwoLeadMagnetId,
			reason: sequence.reason,
		};
	},
});
