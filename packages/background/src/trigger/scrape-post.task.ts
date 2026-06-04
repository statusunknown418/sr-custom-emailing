import { logger, schemaTask } from "@trigger.dev/sdk";

import { scrapeLinkedinPost } from "../apify";
import { updatePostCache } from "../internal-api";
import { generatePostEmailSequence } from "../lead-magnet-selection";
import { scrapePostPayloadSchema } from "../types";

/**
 * Scrape one LinkedIn post, select the post-level lead magnet sequence, author
 * the 3-email template, and persist it all to the D1 cache.
 *
 * Flow: Apify scrape -> validate non-empty content -> Claude selects 3 distinct
 * magnets and writes the template -> POST the internal `post-cache/update`
 * endpoint (the only path to D1 from a task). Fails loudly at every step so a
 * post is never cached with empty content or an invalid selection.
 */
export const scrapePost = schemaTask({
	id: "scrape-post",
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

		const sequence = await generatePostEmailSequence({
			postContent: post.postContent,
			posterName: post.posterName,
		});
		logger.info("Selected lead magnet sequence", {
			originalPostUrl,
			targetedLeadMagnetId: sequence.targetedLeadMagnetId,
			followUpOneLeadMagnetId: sequence.followUpOneLeadMagnetId,
			followUpTwoLeadMagnetId: sequence.followUpTwoLeadMagnetId,
		});

		await updatePostCache({
			originalPostUrl,
			postContent: post.postContent,
			posterName: post.posterName,
			targetedLeadMagnetId: sequence.targetedLeadMagnetId,
			followUpOneLeadMagnetId: sequence.followUpOneLeadMagnetId,
			followUpTwoLeadMagnetId: sequence.followUpTwoLeadMagnetId,
			email1Subject: sequence.template.email1.subject,
			email1Body: sequence.template.email1.body,
			followUp1Subject: sequence.template.followUp1.subject,
			followUp1Body: sequence.template.followUp1.body,
			followUp2Subject: sequence.template.followUp2.subject,
			followUp2Body: sequence.template.followUp2.body,
		});

		return {
			originalPostUrl,
			posterName: post.posterName,
			targetedLeadMagnetId: sequence.targetedLeadMagnetId,
			followUpOneLeadMagnetId: sequence.followUpOneLeadMagnetId,
			followUpTwoLeadMagnetId: sequence.followUpTwoLeadMagnetId,
			reason: sequence.reason,
		};
	},
});
