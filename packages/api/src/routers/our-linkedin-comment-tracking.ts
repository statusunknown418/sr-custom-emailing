import {
	leadBatchPayloadSchema,
	scrapePostPayloadSchema,
	triggerCommentTrackingGenerate,
} from "@sr-custom-emailing/background";

import { internalProcedure } from "../auth";
import { runScrape } from "../scrape-service";

/**
 * Tracking commenters on OUR LinkedIn posts: scrape the post, author a 2-message
 * LinkedIn DM sequence, then emit one DM row per commenter to the Google Sheet.
 */
export const ourLinkedinCommentTrackingRouter = {
	startScraping: internalProcedure
		.route({
			method: "POST",
			path: "/our-linkedin-comment-tracking/scrape",
		})
		.input(scrapePostPayloadSchema)
		.handler(({ input }) =>
			runScrape("comment_tracking", input.originalPostUrl)
		),

	startGenerate: internalProcedure
		.route({
			method: "POST",
			path: "/our-linkedin-comment-tracking/generate",
		})
		.input(leadBatchPayloadSchema)
		.handler(async ({ input }) => {
			const handle = await triggerCommentTrackingGenerate(input);

			return { runId: handle.id };
		}),
};
