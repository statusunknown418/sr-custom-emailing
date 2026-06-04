import {
	emailGenerationPayloadSchema,
	startLinkedinScrapingPayloadSchema,
	triggerEmailGeneration,
	triggerScrapePost,
} from "@sr-custom-emailing/background";
import { normalizePostUrl } from "@sr-custom-emailing/background/url";
import { getPostByUrl, insertPendingPost } from "@sr-custom-emailing/db";

import { internalProcedure } from "../auth";

export const automationsRouter = {
	startLinkedinScraping: internalProcedure
		.route({
			method: "POST",
			path: "/automation/linkedin-scraping",
		})
		.input(startLinkedinScrapingPayloadSchema)
		.handler(async ({ input }) => {
			const originalPostUrl = normalizePostUrl(input.originalPostUrl);
			const existing = await getPostByUrl(originalPostUrl);

			if (
				existing?.scraped &&
				existing.postContent &&
				existing.targetedLeadMagnetId &&
				existing.followUpOneLeadMagnetId &&
				existing.followUpTwoLeadMagnetId
			) {
				return {
					status: "cached" as const,
					originalPostUrl,
					targetedLeadMagnetId: existing.targetedLeadMagnetId,
					followUpOneLeadMagnetId: existing.followUpOneLeadMagnetId,
					followUpTwoLeadMagnetId: existing.followUpTwoLeadMagnetId,
				};
			}

			if (!existing) {
				await insertPendingPost(originalPostUrl);
			}

			// Scrape the raw URL the caller provided; the cache key is normalized.
			const handle = await triggerScrapePost({
				originalPostUrl: input.originalPostUrl,
			});

			return { status: "started" as const, runId: handle.id };
		}),

	startEmailGeneration: internalProcedure
		.route({
			method: "POST",
			path: "/automation/email-generation",
		})
		.input(emailGenerationPayloadSchema)
		.handler(async ({ input }) => {
			const handle = await triggerEmailGeneration(input);

			return { runId: handle.id };
		}),
};
