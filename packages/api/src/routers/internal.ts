import {
	postCacheBatchGetPayloadSchema,
	postCacheUpdatePayloadSchema,
} from "@sr-custom-emailing/background/types";
import { normalizePostUrl } from "@sr-custom-emailing/background/url";
import { getPostsByUrls, upsertScrapedPost } from "@sr-custom-emailing/db";

import { internalProcedure } from "../auth";

export const internalRouter = {
	postCacheUpdate: internalProcedure
		.route({
			method: "POST",
			path: "/automation/internal/post-cache/update",
		})
		.input(postCacheUpdatePayloadSchema)
		.handler(async ({ input }) => {
			await upsertScrapedPost({
				originalPostUrl: normalizePostUrl(input.originalPostUrl),
				postContent: input.postContent,
				posterName: input.posterName ?? null,
				targetedLeadMagnetId: input.targetedLeadMagnetId,
				followUpOneLeadMagnetId: input.followUpOneLeadMagnetId,
				followUpTwoLeadMagnetId: input.followUpTwoLeadMagnetId,
				email1Subject: input.email1Subject,
				email1Body: input.email1Body,
				followUp1Subject: input.followUp1Subject,
				followUp1Body: input.followUp1Body,
				followUp2Subject: input.followUp2Subject,
				followUp2Body: input.followUp2Body,
			});

			return { ok: true };
		}),

	postCacheBatchGet: internalProcedure
		.route({
			method: "POST",
			path: "/automation/internal/post-cache/batch-get",
		})
		.input(postCacheBatchGetPayloadSchema)
		.handler(async ({ input }) => {
			const normalizedUrls = input.originalPostUrls.map(normalizePostUrl);
			const rows = await getPostsByUrls(normalizedUrls);

			return {
				rows: rows.map((row) => ({
					originalPostUrl: row.originalPostUrl,
					scraped: row.scraped,
					postContent: row.postContent,
					posterName: row.posterName,
					targetedLeadMagnetId: row.targetedLeadMagnetId,
					followUpOneLeadMagnetId: row.followUpOneLeadMagnetId,
					followUpTwoLeadMagnetId: row.followUpTwoLeadMagnetId,
					email1Subject: row.email1Subject,
					email1Body: row.email1Body,
					followUp1Subject: row.followUp1Subject,
					followUp1Body: row.followUp1Body,
					followUp2Subject: row.followUp2Subject,
					followUp2Body: row.followUp2Body,
				})),
			};
		}),
};
