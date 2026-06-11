import { logger, schemaTask } from "@trigger.dev/sdk";

import { applyLeadVariables, type EmailSequence } from "../emails";
import { addLeadsToCampaign, type InstantlyLead } from "../instantly";
import { batchGetPostCache } from "../internal-api";
import { getFirstName } from "../names";
import { leadBatchPayloadSchema, type PostCacheRow } from "../types";
import { normalizePostUrl } from "../url";

/** Split a full name into first/last tokens for Instantly's standard fields. */
const WHITESPACE_RE = /\s+/;

/**
 * Narrow a cached row to its email template only when it was scraped for the
 * someone-else flow and all six template fields are present. Returns `null` for
 * pending, partially-written, or wrong-flow rows so the task can fail with the
 * exact URL list rather than push blank copy.
 */
function toEmailTemplate(row: PostCacheRow): EmailSequence | null {
	const {
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
			row.source === "someone_else" &&
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
		email1: { subject: email1Subject, body: email1Body },
		followUp1: { subject: followUp1Subject, body: followUp1Body },
		followUp2: { subject: followUp2Subject, body: followUp2Body },
	};
}

/**
 * Someone-else flow: push one lead per Clay row into the configured Instantly
 * campaign, carrying the post's authored email copy as custom variables.
 *
 * Flow: drop leads with no email -> normalize and group by `originalPostUrl` ->
 * fetch cached posts via `post-cache/batch-get` -> fail with the exact URL list
 * if any post is missing or not fully scraped -> substitute `${firstName}` per
 * lead into the stored template -> add each lead to the campaign. Pushing is not
 * idempotent, so `maxAttempts` is 1; re-trigger manually if a run fails.
 */
export const someoneElseGenerate = schemaTask({
	id: "someone-else-generate",
	schema: leadBatchPayloadSchema,
	retry: { maxAttempts: 1 },
	run: async (payload) => {
		const { leads } = payload;
		// Instantly requires an email; an emailless lead can never be imported.
		const emailLeads = leads.filter((lead) => lead.email?.trim());
		const skippedNoEmail = leads.length - emailLeads.length;
		if (skippedNoEmail > 0) {
			logger.warn("Skipped leads without an email address; not pushed", {
				skippedNoEmail,
				leadCount: leads.length,
			});
		}

		if (emailLeads.length === 0) {
			const result = await addLeadsToCampaign([]);
			logger.info("No leads pushed; every lead was missing an email", {
				leadCount: leads.length,
				added: result.added,
			});

			return result;
		}

		const normalizedUrls = [
			...new Set(
				emailLeads.map((lead) => normalizePostUrl(lead.originalPostUrl))
			),
		];

		const { rows } = await batchGetPostCache(normalizedUrls);
		const templateByUrl = new Map(
			rows.map((row) => [row.originalPostUrl, row])
		);

		const readyByUrl = new Map<string, EmailSequence>();
		const missing: string[] = [];
		for (const url of normalizedUrls) {
			const row = templateByUrl.get(url);
			const template = row ? toEmailTemplate(row) : null;
			if (template) {
				readyByUrl.set(url, template);
			} else {
				missing.push(url);
			}
		}

		if (missing.length > 0) {
			throw new Error(
				`Cannot generate emails; posts not scraped yet: ${missing.join(", ")}`
			);
		}

		const instantlyLeads = emailLeads.map((lead) => {
			const url = normalizePostUrl(lead.originalPostUrl);
			const template = readyByUrl.get(url);
			if (!template) {
				throw new Error(`Missing cached post for ${url}`);
			}

			const rendered = applyLeadVariables(template, {
				firstName: getFirstName(lead.name),
			});
			const [firstNamePart = "", ...lastNameParts] = lead.name
				.trim()
				.split(WHITESPACE_RE)
				.filter(Boolean);

			return {
				email: lead.email ?? "",
				firstName: firstNamePart,
				lastName: lastNameParts.join(" "),
				companyName: lead.companyName,
				customVariables: {
					email1Subject: rendered.email1.subject,
					email1Body: rendered.email1.body,
					followUp1Subject: rendered.followUp1.subject,
					followUp1Body: rendered.followUp1.body,
					followUp2Subject: rendered.followUp2.subject,
					followUp2Body: rendered.followUp2.body,
				},
			} satisfies InstantlyLead;
		});

		const result = await addLeadsToCampaign(instantlyLeads);
		logger.info("Pushed leads to Instantly", {
			added: result.added,
			skipped: result.skipped,
			leadCount: leads.length,
		});

		return result;
	},
});
