import { logger, schemaTask } from "@trigger.dev/sdk";

import { applyLeadVariables, type EmailSequence } from "../emails";
import { appendEmailRows, type EmailSheetRow } from "../google-sheets";
import { batchGetPostCache } from "../internal-api";
import { resolveLeadMagnetSequence } from "../lead-magnets";
import { getFirstName } from "../names";
import {
	type ClayLead,
	emailGenerationPayloadSchema,
	type PostCacheRow,
} from "../types";
import { normalizePostUrl } from "../url";

/** A cached post with a complete (non-null) template and magnet selection. */
interface CompletePost {
	followUpOneLeadMagnetId: string;
	followUpTwoLeadMagnetId: string;
	targetedLeadMagnetId: string;
	template: EmailSequence;
}

/**
 * Narrow a cached row to a {@link CompletePost} only when it has been scraped
 * and every magnet id and template field is present. Returns `null` for pending
 * or partially-written rows so the task can fail with the exact URL list rather
 * than emit generic copy.
 */
function toCompletePost(row: PostCacheRow): CompletePost | null {
	const {
		targetedLeadMagnetId,
		followUpOneLeadMagnetId,
		followUpTwoLeadMagnetId,
		email1Subject,
		email1Body,
		followUp1Subject,
		followUp1Body,
		followUp2Subject,
		followUp2Body,
	} = row;

	if (
		!(
			row.scraped &&
			targetedLeadMagnetId &&
			followUpOneLeadMagnetId &&
			followUpTwoLeadMagnetId &&
			email1Subject &&
			email1Body &&
			followUp1Subject &&
			followUp1Body &&
			followUp2Subject &&
			followUp2Body
		)
	) {
		return null;
	}

	return {
		targetedLeadMagnetId,
		followUpOneLeadMagnetId,
		followUpTwoLeadMagnetId,
		template: {
			email1: { subject: email1Subject, body: email1Body },
			followUp1: { subject: followUp1Subject, body: followUp1Body },
			followUp2: { subject: followUp2Subject, body: followUp2Body },
		},
	};
}

function buildSheetRow(lead: ClayLead, post: CompletePost): EmailSheetRow {
	const firstName = getFirstName(lead.name);
	const emails = applyLeadVariables(post.template, { firstName });
	const magnets = resolveLeadMagnetSequence({
		targetedLeadMagnetId: post.targetedLeadMagnetId,
		followUpOneLeadMagnetId: post.followUpOneLeadMagnetId,
		followUpTwoLeadMagnetId: post.followUpTwoLeadMagnetId,
	});

	return {
		email: lead.email ?? "",
		firstName,
		name: lead.name,
		companyName: lead.companyName,
		companyUrl: lead.companyUrl,
		companyLinkedin: lead.companyLinkedin,
		companyEmployees: lead.companyEmployees,
		companyIndustry: lead.companyIndustry,
		companyDescription: lead.companyDescription,
		country: lead.country,
		personalLinkedinUrl: lead.personalLinkedinUrl,
		originalComment: lead.originalComment,
		originalPostUrl: lead.originalPostUrl,
		targetedLeadMagnet: magnets.targeted.leadMagnet,
		targetedLeadMagnetDescription: magnets.targeted.description,
		targetedPainLine: magnets.targeted.painLine,
		followUpOneLeadMagnet: magnets.followUpOne.leadMagnet,
		followUpOneDescription: magnets.followUpOne.description,
		followUpOnePainLine: magnets.followUpOne.painLine,
		followUpTwoLeadMagnet: magnets.followUpTwo.leadMagnet,
		followUpTwoDescription: magnets.followUpTwo.description,
		followUpTwoPainLine: magnets.followUpTwo.painLine,
		email1Subject: emails.email1.subject,
		email1Body: emails.email1.body,
		followUp1Subject: emails.followUp1.subject,
		followUp1Body: emails.followUp1.body,
		followUp2Subject: emails.followUp2.subject,
		followUp2Body: emails.followUp2.body,
	};
}

/**
 * Generate the 3-email sequence for each Clay lead and append one Instantly-ready
 * row per lead to the output Google Sheet.
 *
 * Flow: normalize and group leads by `originalPostUrl` -> fetch cached posts via
 * the internal `post-cache/batch-get` endpoint -> fail with the exact URL list
 * if any post is missing or not fully scraped -> substitute `${firstName}` into
 * the stored template (no model call) -> append rows. The lead's original
 * `originalPostUrl` is preserved in the Sheet; normalization is only the cache
 * key. Appending is not idempotent (it writes new rows), so `maxAttempts` is 1
 * to avoid duplicate rows on retry; re-trigger manually if a run fails.
 */
export const emailGeneration = schemaTask({
	id: "email-generation",
	schema: emailGenerationPayloadSchema,
	retry: { maxAttempts: 1 },
	run: async (payload) => {
		const { leads } = payload;
		// Drop leads with no email up front: Instantly can't import an emailless
		// row, so it never reaches the Sheet (and its post is not required below).
		const leadsWithEmail = leads.filter((lead) => lead.email?.trim());
		const skippedNoEmail = leads.length - leadsWithEmail.length;
		if (skippedNoEmail > 0) {
			logger.warn("Skipped leads without an email address; not written", {
				skippedNoEmail,
				leadCount: leads.length,
			});
		}

		const normalizedUrls = [
			...new Set(
				leadsWithEmail.map((lead) => normalizePostUrl(lead.originalPostUrl))
			),
		];

		const { rows } = await batchGetPostCache(normalizedUrls);
		const postByUrl = new Map(rows.map((row) => [row.originalPostUrl, row]));

		const readyByUrl = new Map<string, CompletePost>();
		const missing: string[] = [];
		for (const url of normalizedUrls) {
			const row = postByUrl.get(url);
			const complete = row ? toCompletePost(row) : null;
			if (complete) {
				readyByUrl.set(url, complete);
			} else {
				missing.push(url);
			}
		}

		if (missing.length > 0) {
			throw new Error(
				`Cannot generate emails; posts not scraped yet: ${missing.join(", ")}`
			);
		}

		const sheetRows = leadsWithEmail.map((lead) => {
			const url = normalizePostUrl(lead.originalPostUrl);
			const post = readyByUrl.get(url);
			if (!post) {
				throw new Error(`Missing cached post for ${url}`);
			}
			return buildSheetRow(lead, post);
		});

		const result = await appendEmailRows(sheetRows);
		logger.info("Appended email rows", {
			rowsWritten: result.rowsWritten,
			leadCount: leads.length,
		});

		return result;
	},
});
