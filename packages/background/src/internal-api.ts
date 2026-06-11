import { z } from "zod";

import { requireEnv } from "./process-env";
import { type PostCacheUpdatePayload, postCacheRowSchema } from "./types";

const INTERNAL_SECRET_HEADER = "x-internal-secret";

/**
 * OpenAPI mount prefix used by `apps/server` (`OpenAPIHandler` is mounted at
 * `/api-reference`). Internal endpoint paths are relative to this prefix.
 */
const OPENAPI_PREFIX = "/api-reference";

const TRAILING_SLASHES_RE = /\/+$/;

const updateResponseSchema = z.object({ ok: z.boolean() });

const batchGetResponseSchema = z.object({
	rows: z.array(postCacheRowSchema),
});

/** Cached rows for a set of normalized post URLs. */
export type BatchGetPostCacheResponse = z.infer<typeof batchGetResponseSchema>;

async function postInternal<T>(
	path: string,
	body: unknown,
	schema: z.ZodType<T>
): Promise<T> {
	const base = requireEnv("INTERNAL_API_URL").replace(TRAILING_SLASHES_RE, "");
	const secret = requireEnv("INTERNAL_API_SECRET");

	const endpoint = `${base}${OPENAPI_PREFIX}${path}`;

	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			[INTERNAL_SECRET_HEADER]: secret,
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const { origin } = new URL(endpoint);
		const detail = await response.text().catch(() => "");
		throw new Error(
			`Internal API ${path} failed: ${response.status} ${response.statusText} ${detail} (diagnostics: origin=${origin}, secretDefined=${String(secret.length > 0)}, secretLength=${secret.length})`.trim()
		);
	}

	return schema.parse(await response.json());
}

/**
 * Write a scraped post's content, selected magnet ids, and authored email
 * template to D1 via the protected internal endpoint. The Worker normalizes the
 * URL and upserts the cache row.
 */
export function updatePostCache(
	payload: PostCacheUpdatePayload
): Promise<z.infer<typeof updateResponseSchema>> {
	return postInternal(
		"/internal/post-cache/update",
		payload,
		updateResponseSchema
	);
}

/**
 * Fetch cached post rows by their normalized URLs via the protected internal
 * endpoint. Missing URLs are simply absent from the returned `rows`.
 */
export function batchGetPostCache(
	originalPostUrls: string[]
): Promise<BatchGetPostCacheResponse> {
	return postInternal(
		"/internal/post-cache/batch-get",
		{ originalPostUrls },
		batchGetResponseSchema
	);
}
