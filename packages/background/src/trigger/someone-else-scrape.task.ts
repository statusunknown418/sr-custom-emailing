import { logger, schemaTask } from "@trigger.dev/sdk";

import { scrapeLinkedinPost } from "../apify";
import { updatePostCache } from "../internal-api";
import { generatePostEmailSequence } from "../lead-magnet-selection";
import { scrapePostPayloadSchema } from "../types";

/**
 * Someone-else flow: scrape someone else's LinkedIn post, select the post-level
 * lead magnet sequence, author the 3-email template, and persist it to the D1
 * cache (`source = someone_else`) for the Instantly push.
 *
 * Flow: Apify scrape -> validate non-empty content -> Claude selects 3 distinct
 * magnets and writes the email template -> POST the internal `post-cache/update`
 * endpoint. Fails loudly so a post is never cached half-written.
 */
export const someoneElseScrape = schemaTask({
	id: "someone-else-scrape",
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
		logger.info("Authored email sequence", {
			originalPostUrl,
			posterLeadMagnet: sequence.posterLeadMagnet,
			targetedLeadMagnetId: sequence.targetedLeadMagnetId,
			followUpOneLeadMagnetId: sequence.followUpOneLeadMagnetId,
			followUpTwoLeadMagnetId: sequence.followUpTwoLeadMagnetId,
		});

		await updatePostCache({
			source: "someone_else",
			originalPostUrl,
			postContent: post.postContent,
			posterName: post.posterName,
			posterLeadMagnet: sequence.posterLeadMagnet,
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
			posterLeadMagnet: sequence.posterLeadMagnet,
			targetedLeadMagnetId: sequence.targetedLeadMagnetId,
			followUpOneLeadMagnetId: sequence.followUpOneLeadMagnetId,
			followUpTwoLeadMagnetId: sequence.followUpTwoLeadMagnetId,
			reason: sequence.reason,
		};
	},
});
