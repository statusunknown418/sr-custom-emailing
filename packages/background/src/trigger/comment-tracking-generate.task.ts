import { logger, schemaTask } from "@trigger.dev/sdk";

import { applyDmLeadVariables } from "../emails";
import { appendDmRows, type DmSheetRow } from "../google-sheets";
import { batchGetPostCache } from "../internal-api";
import { getFirstName } from "../names";
import { leadBatchPayloadSchema, type PostCacheRow } from "../types";
import { normalizePostUrl } from "../url";

/** A cached comment-tracking post with all three DM bodies present. */
interface CompleteDmPost {
	dm1: string;
	dm2: string;
	dm3: string;
}

/**
 * Narrow a cached row to a {@link CompleteDmPost} only when it was scraped for
 * the comment-tracking flow and all three DM bodies are present. Returns `null`
 * for pending, partially-written, or wrong-flow rows so the task can fail with
 * the exact URL list rather than emit blank DMs.
 */
function toCompleteDmPost(row: PostCacheRow): CompleteDmPost | null {
	const { dm1Body, dm2Body, dm3Body } = row;

	if (
		!(
			row.scraped &&
			row.source === "comment_tracking" &&
			dm1Body &&
			dm2Body &&
			dm3Body
		)
	) {
		return null;
	}

	return { dm1: dm1Body, dm2: dm2Body, dm3: dm3Body };
}

/**
 * Comment-tracking flow: append one Instantly-free LinkedIn DM row per lead to
 * the output Google Sheet (`Date | Name | LinkedIn URL | Follow Up | 2nd Follow
 * Up | 3rd Follow Up`).
 *
 * Flow: drop leads with no LinkedIn URL -> normalize and group by
 * `originalPostUrl` -> fetch cached posts via `post-cache/batch-get` -> fail
 * with the exact URL list if any post is missing or not fully scraped ->
 * substitute each lead's first name into the DM bodies (`{{firstname}}` ->
 * `getFirstName(lead.name)`) and write them. Appending is not idempotent, so
 * `maxAttempts` is 1 to avoid
 * duplicate rows on retry; re-trigger manually if a run fails.
 */
export const commentTrackingGenerate = schemaTask({
	id: "comment-tracking-generate",
	schema: leadBatchPayloadSchema,
	retry: { maxAttempts: 1 },
	run: async (payload) => {
		const { leads } = payload;
		// A LinkedIn DM needs a profile URL; a lead without one can never be
		// messaged, so it never reaches the Sheet (and its post is not required).
		const dmableLeads = leads.filter((lead) => lead.personalLinkedinUrl.trim());
		const skippedNoUrl = leads.length - dmableLeads.length;
		if (skippedNoUrl > 0) {
			logger.warn("Skipped leads without a LinkedIn URL; not written", {
				skippedNoUrl,
				leadCount: leads.length,
			});
		}

		if (dmableLeads.length === 0) {
			const result = await appendDmRows([]);
			logger.info(
				"No DM rows appended; every lead was missing a LinkedIn URL",
				{
					leadCount: leads.length,
					rowsWritten: result.rowsWritten,
				}
			);

			return result;
		}

		const normalizedUrls = [
			...new Set(
				dmableLeads.map((lead) => normalizePostUrl(lead.originalPostUrl))
			),
		];

		const { rows } = await batchGetPostCache(normalizedUrls);
		const postByUrl = new Map(rows.map((row) => [row.originalPostUrl, row]));

		const readyByUrl = new Map<string, CompleteDmPost>();
		const missing: string[] = [];
		for (const url of normalizedUrls) {
			const row = postByUrl.get(url);
			const complete = row ? toCompleteDmPost(row) : null;
			if (complete) {
				readyByUrl.set(url, complete);
			} else {
				missing.push(url);
			}
		}

		if (missing.length > 0) {
			throw new Error(
				`Cannot generate DMs; posts not scraped yet: ${missing.join(", ")}`
			);
		}

		const sheetDate = new Date().toISOString().slice(0, 10);

		const sheetRows = dmableLeads.map((lead) => {
			const url = normalizePostUrl(lead.originalPostUrl);
			const post = readyByUrl.get(url);
			if (!post) {
				throw new Error(`Missing cached post for ${url}`);
			}
			const dms = applyDmLeadVariables(post, {
				firstName: getFirstName(lead.name),
			});
			return {
				date: sheetDate,
				name: lead.name,
				linkedinUrl: lead.personalLinkedinUrl,
				followUp: dms.dm1,
				followUp2: dms.dm2,
				followUp3: dms.dm3,
			} satisfies DmSheetRow;
		});

		const result = await appendDmRows(sheetRows);
		logger.info("Appended DM rows", {
			rowsWritten: result.rowsWritten,
			leadCount: leads.length,
		});

		return result;
	},
});
