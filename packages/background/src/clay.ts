import type { Commenter } from "./apify";
import { requireEnv } from "./process-env";
import type { PostSource } from "./types";

/**
 * One commenter forwarded to Clay for enrichment. Field names mirror
 * `clayLeadSchema` so Clay maps the round trip without renaming; `flow` tells
 * Clay which generate endpoint to post the enriched lead back to.
 */
export interface ClayCommenterLead {
	flow: PostSource;
	name: string;
	originalComment: string;
	originalPostUrl: string;
	personalLinkedinUrl: string;
}

/**
 * POST commenters to the configured Clay enricher table for enrichment. Maps
 * each commenter to a Clay lead (profile URL -> `personalLinkedinUrl`, Clay's
 * enrichment key) and tags every lead — and the batch — with `flow` +
 * `originalPostUrl` so Clay can route each enriched row back to the matching
 * generate endpoint. Runs inside the forward Trigger task, so the Clay table URL
 * + auth token are read from `process.env`. The token is sent as the
 * `x-clay-webhook-auth` header (Clay webhook auth). Fails loudly on a non-2xx
 * response.
 *
 * @param flow - The owning flow flag.
 * @param originalPostUrl - The normalized post URL the commenters belong to.
 * @param commenters - The parsed commenters to enrich.
 * @throws If `CLAY_ENRICHER_TABLE_URL`/`CLAY_ENRICHER_AUTH_TOKEN` are missing or
 *   Clay returns a non-2xx status.
 */
export async function sendCommentersToClay(
	flow: PostSource,
	originalPostUrl: string,
	commenters: Commenter[]
): Promise<void> {
	const tableUrl = requireEnv("CLAY_ENRICHER_TABLE_URL");
	const authToken = requireEnv("CLAY_ENRICHER_AUTH_TOKEN");
	const leads: ClayCommenterLead[] = commenters.map((commenter) => ({
		flow,
		name: commenter.name ?? "",
		originalComment: commenter.comment,
		originalPostUrl,
		personalLinkedinUrl: commenter.profileUrl,
	}));

	const response = await fetch(tableUrl, {
		body: JSON.stringify({ flow, leads, originalPostUrl }),
		headers: {
			"Content-Type": "application/json",
			"x-clay-webhook-auth": authToken,
		},
		method: "POST",
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(
			`Clay webhook failed (${response.status} ${response.statusText}): ${detail}`.trim()
		);
	}
}
