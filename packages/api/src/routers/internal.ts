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
			path: "/internal/post-cache/update",
		})
		.input(postCacheUpdatePayloadSchema)
		.handler(async ({ input }) => {
			const base = {
				originalPostUrl: normalizePostUrl(input.originalPostUrl),
				postContent: input.postContent,
				posterName: input.posterName ?? null,
				posterLeadMagnet: input.posterLeadMagnet,
				targetedLeadMagnetId: input.targetedLeadMagnetId,
				followUpOneLeadMagnetId: input.followUpOneLeadMagnetId,
				followUpTwoLeadMagnetId: input.followUpTwoLeadMagnetId,
			};

			if (input.source === "comment_tracking") {
				await upsertScrapedPost({
					...base,
					source: "comment_tracking",
					dm1Body: input.dm1Body,
					dm2Body: input.dm2Body,
					dm3Body: input.dm3Body,
				});
			} else {
				await upsertScrapedPost({
					...base,
					source: "someone_else",
					email1Subject: input.email1Subject,
					email1Body: input.email1Body,
					followUp1Subject: input.followUp1Subject,
					followUp1Body: input.followUp1Body,
					followUp2Subject: input.followUp2Subject,
					followUp2Body: input.followUp2Body,
				});
			}

			return { ok: true };
		}),

	postCacheBatchGet: internalProcedure
		.route({
			method: "POST",
			path: "/internal/post-cache/batch-get",
		})
		.input(postCacheBatchGetPayloadSchema)
		.handler(async ({ input }) => {
			const normalizedUrls = input.originalPostUrls.map(normalizePostUrl);
			const rows = await getPostsByUrls(normalizedUrls);

			return {
				rows: rows.map((row) => ({
					originalPostUrl: row.originalPostUrl,
					source: row.source,
					scraped: row.scraped,
					postContent: row.postContent,
					posterName: row.posterName,
					posterLeadMagnet: row.posterLeadMagnet,
					targetedLeadMagnetId: row.targetedLeadMagnetId,
					followUpOneLeadMagnetId: row.followUpOneLeadMagnetId,
					followUpTwoLeadMagnetId: row.followUpTwoLeadMagnetId,
					email1Subject: row.email1Subject,
					email1Body: row.email1Body,
					followUp1Subject: row.followUp1Subject,
					followUp1Body: row.followUp1Body,
					followUp2Subject: row.followUp2Subject,
					followUp2Body: row.followUp2Body,
					dm1Body: row.dm1Body,
					dm2Body: row.dm2Body,
					dm3Body: row.dm3Body,
				})),
			};
		}),
};
