import { logger, schemaTask } from "@trigger.dev/sdk";

import { startCommenterScrape } from "../apify";
import { requireEnv } from "../process-env";
import { harvestCommentersPayloadSchema } from "../types";
import { normalizePostUrl } from "../url";

const TRAILING_SLASHES_RE = /\/+$/;

/**
 * Harvest the commenters on one LinkedIn post via Apify, for a given flow.
 *
 * Flow: start an async Apify run of the post-comments actor with an ad-hoc
 * completion webhook pointing at our Worker (`/apify/commenters/{flow}`), the
 * normalized post URL carried as a query param and a shared secret in a header.
 * The run is NOT awaited; Apify calls the webhook when it finishes, which
 * enqueues `forward-commenters-to-clay`. The flow in the webhook path is the
 * thread that lets the enriched leads route back to the matching generate
 * endpoint. Starting a run is not idempotent, so `maxAttempts` is 1 to avoid
 * launching duplicate harvests on retry; re-trigger manually if it fails.
 */
export const harvestCommenters = schemaTask({
	id: "harvest-commenters",
	schema: harvestCommentersPayloadSchema,
	retry: { maxAttempts: 1 },
	run: async (payload) => {
		const { flow, originalPostUrl } = payload;
		const base = requireEnv("INTERNAL_API_URL").replace(
			TRAILING_SLASHES_RE,
			""
		);
		const secret = requireEnv("APIFY_WEBHOOK_SECRET");
		const normalizedUrl = normalizePostUrl(originalPostUrl);
		const webhookUrl = `${base}/apify/commenters/${flow}?postUrl=${encodeURIComponent(normalizedUrl)}`;

		const runId = await startCommenterScrape(
			originalPostUrl,
			webhookUrl,
			secret
		);
		logger.info("Started commenter harvest", {
			flow,
			originalPostUrl: normalizedUrl,
			runId,
		});

		return { flow, originalPostUrl: normalizedUrl, runId };
	},
});
