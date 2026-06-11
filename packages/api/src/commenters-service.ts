import { triggerForwardCommentersToClay } from "@sr-custom-emailing/background";
import { postSourceSchema } from "@sr-custom-emailing/background/types";

/** Result of routing an Apify commenter webhook to the Clay-forward task. */
export type ForwardCommentersOutcome =
	| { status: "unknown_flow" }
	| { runId: string; status: "forwarded" };

/**
 * Validate the flow flag carried on an Apify commenter-harvest webhook and
 * enqueue the `forward-commenters-to-clay` task. Lives in packages/api so the
 * server app depends only on the api package (mirrors `runScrape`), keeping the
 * background dependency out of the HTTP edge.
 *
 * @param flow - The raw flow flag from the webhook path (validated here).
 * @param originalPostUrl - The normalized post URL the commenters belong to.
 * @param datasetId - The finished run's default dataset id.
 * @returns `unknown_flow` for an unrecognized flag, otherwise the enqueued run.
 */
export async function forwardHarvestedCommenters(
	flow: string,
	originalPostUrl: string,
	datasetId: string
): Promise<ForwardCommentersOutcome> {
	const parsedFlow = postSourceSchema.safeParse(flow);
	if (!parsedFlow.success) {
		return { status: "unknown_flow" };
	}

	const handle = await triggerForwardCommentersToClay({
		datasetId,
		flow: parsedFlow.data,
		originalPostUrl,
	});
	return { runId: handle.id, status: "forwarded" };
}
