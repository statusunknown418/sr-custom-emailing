import { forwardHarvestedCommenters } from "@sr-custom-emailing/api/commenters-service";
import { env } from "@sr-custom-emailing/env/server";
import type { Context } from "hono";

const WEBHOOK_SECRET_HEADER = "x-apify-webhook-secret";
/** The only terminal run event whose dataset we forward to Clay. */
const SUCCEEDED_EVENT = "ACTOR.RUN.SUCCEEDED";

interface ApifyWebhookBody {
	eventType?: string;
	resource?: { defaultDatasetId?: string };
}

/** Constant-time string comparison so the secret can't be probed via timing. */
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
 * Receive an Apify completion webhook for a commenter-harvest run and enqueue
 * the Clay-forward task. The flow flag is carried in the path (`:flow`) and the
 * normalized post URL in the `postUrl` query param — both set when the run was
 * started — so the enriched leads route back to the matching generate endpoint.
 * Fails closed on a missing/invalid shared secret. Non-SUCCEEDED terminal events
 * (failed/aborted/timed-out) and malformed payloads are acknowledged with 200
 * and logged, not forwarded, so Apify does not keep retrying the webhook.
 */
export async function handleApifyCommentersWebhook(
	c: Context
): Promise<Response> {
	const expectedSecret = env.APIFY_WEBHOOK_SECRET;
	const providedSecret = c.req.header(WEBHOOK_SECRET_HEADER);
	if (
		!expectedSecret ||
		providedSecret === undefined ||
		!safeEqual(providedSecret, expectedSecret)
	) {
		return c.text("invalid webhook secret", 401);
	}

	const flow = c.req.param("flow");
	if (!flow) {
		return c.text("unknown flow", 400);
	}

	const originalPostUrl = c.req.query("postUrl");
	if (!originalPostUrl) {
		return c.text("missing postUrl", 400);
	}

	const body = (await c.req
		.json()
		.catch(() => null)) as ApifyWebhookBody | null;
	const eventType = body?.eventType;
	const datasetId = body?.resource?.defaultDatasetId;

	if (eventType !== SUCCEEDED_EVENT || !datasetId) {
		console.error("Apify commenter run not forwarded", {
			datasetId,
			eventType,
			flow,
			originalPostUrl,
		});
		return c.json({ forwarded: false, ok: true });
	}

	const outcome = await forwardHarvestedCommenters(
		flow,
		originalPostUrl,
		datasetId
	);
	if (outcome.status === "unknown_flow") {
		return c.text("unknown flow", 400);
	}

	return c.json({ forwarded: true, ok: true, runId: outcome.runId });
}
