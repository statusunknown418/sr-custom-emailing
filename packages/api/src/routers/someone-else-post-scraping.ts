import {
	leadBatchPayloadSchema,
	scrapePostPayloadSchema,
	triggerSomeoneElseGenerate,
} from "@sr-custom-emailing/background";

import { internalProcedure } from "../auth";
import { runScrape } from "../scrape-service";

/**
 * Scraping SOMEONE ELSE's LinkedIn posts: scrape the post, author a 3-email
 * sequence, then push one lead per commenter into the configured Instantly
 * campaign with the authored copy as custom variables.
 */
export const someoneElsePostScrapingRouter = {
	startScraping: internalProcedure
		.route({
			method: "POST",
			path: "/someone-else-post-scraping/scrape",
		})
		.input(scrapePostPayloadSchema)
		.handler(({ input }) => runScrape("someone_else", input.originalPostUrl)),

	startGenerate: internalProcedure
		.route({
			method: "POST",
			path: "/someone-else-post-scraping/generate",
		})
		.input(leadBatchPayloadSchema)
		.handler(async ({ input }) => {
			const handle = await triggerSomeoneElseGenerate(input);

			return { runId: handle.id };
		}),
};
