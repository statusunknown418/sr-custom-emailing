import { ORPCError } from "@orpc/server";
import {
	postCacheBatchGetPayloadSchema,
	postCacheUpdatePayloadSchema,
} from "@sr-custom-emailing/background/types";
import { normalizePostUrl } from "@sr-custom-emailing/background/url";
import { getPostsByUrls, upsertScrapedPost } from "@sr-custom-emailing/db";
import { env } from "@sr-custom-emailing/env/server";

import { publicProcedure } from "../index";

const INTERNAL_SECRET_HEADER = "x-internal-secret";

/** Constant-time string comparison to avoid leaking the secret via timing. */
function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}

	let mismatch = 0;
	for (let i = 0; i < a.length; i += 1) {
		if (a.charCodeAt(i) !== b.charCodeAt(i)) {
			mismatch += 1;
		}
	}
	return mismatch === 0;
}

/**
 * Authorize an internal callback. Fails closed: when the secret is not
 * configured on the Worker, every request is rejected.
 */
function isAuthorizedInternalRequest(provided: string | null): boolean {
	const expected = env.INTERNAL_API_SECRET;
	if (!expected || provided === null) {
		return false;
	}

	return safeEqual(provided, expected);
}

/**
 * Procedure guarded by the shared internal secret. Trigger tasks call these
 * endpoints (the only path to D1 from a task, which has no Worker binding) and
 * must send a matching `x-internal-secret` header.
 */
const internalProcedure = publicProcedure.use(({ context, next }) => {
	const provided = context.headers.get(INTERNAL_SECRET_HEADER);
	if (!isAuthorizedInternalRequest(provided)) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Invalid or missing internal secret",
		});
	}

	return next();
});

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
