import { logger, schemaTask } from "@trigger.dev/sdk";

import { fetchApifyDatasetItems, parseCommenters } from "../apify";
import { sendCommentersToClay } from "../clay";
import { forwardCommentersPayloadSchema } from "../types";

/**
 * Forward harvested commenters to Clay for enrichment. Enqueued by the Apify
 * webhook route once a commenter run reaches a terminal SUCCEEDED state.
 *
 * Flow: fetch the run's dataset from Apify -> parse + de-duplicate commenters ->
 * POST them to the Clay webhook tagged with `flow` + `originalPostUrl`. An empty
 * dataset is valid (a post with no usable commenters): it logs and returns
 * without calling Clay. Forwarding to Clay is not idempotent, so `maxAttempts`
 * is 1 to avoid duplicate enrichment rows on retry; re-trigger manually.
 */
export const forwardCommentersToClay = schemaTask({
	id: "forward-commenters-to-clay",
	schema: forwardCommentersPayloadSchema,
	retry: { maxAttempts: 1 },
	run: async (payload) => {
		const { datasetId, flow, originalPostUrl } = payload;

		const items = await fetchApifyDatasetItems(datasetId);
		const commenters = parseCommenters(items);
		logger.info("Parsed commenters", {
			commenterCount: commenters.length,
			datasetId,
			flow,
			itemCount: items.length,
			originalPostUrl,
		});

		if (commenters.length === 0) {
			return { commenterCount: 0, flow, forwarded: false, originalPostUrl };
		}

		await sendCommentersToClay(flow, originalPostUrl, commenters);
		logger.info("Forwarded commenters to Clay", {
			commenterCount: commenters.length,
			flow,
			originalPostUrl,
		});

		return {
			commenterCount: commenters.length,
			flow,
			forwarded: true,
			originalPostUrl,
		};
	},
});
