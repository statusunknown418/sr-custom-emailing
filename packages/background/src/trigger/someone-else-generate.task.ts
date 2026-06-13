import { logger, schemaTask } from "@trigger.dev/sdk";

import { addLeadsToClose, type CloseLead } from "../close";
import { addLeadsToCampaign, type InstantlyLead } from "../instantly";
import { batchGetPostCache } from "../internal-api";
import { derivePosterFirstName } from "../lead-magnet-selection";
import { getLeadMagnetById } from "../lead-magnets";
import { getFirstName } from "../names";
import { leadBatchPayloadSchema, type PostCacheRow } from "../types";
import { normalizePostUrl } from "../url";

/** Split a full name into first/last tokens for Instantly's standard fields. */
const WHITESPACE_RE = /\s+/;

/**
 * Per-post Instantly merge variables shared by every lead scraped from one
 * post. The campaign templates reference them by name: `{{postername}}`,
 * `{{postlabel}}`, `{{ourdescription}}`, `{{painline}}` (the targeted magnet,
 * step 1) and `{{seconddescription}}`, `{{secondpainline}}` (the first
 * follow-up magnet, step 2). The per-lead `{{firstname}}` is added at push time.
 */
interface PostCustomVars {
	ourdescription: string;
	painline: string;
	postername: string;
	postlabel: string;
	seconddescription: string;
	secondpainline: string;
}

/**
 * Build a scraped someone-else post's merge variables, or `null` when the row
 * is pending, wrong-flow, or its selected magnet ids no longer resolve to the
 * catalog — so the task fails with the exact URL list rather than push an email
 * with blank variables.
 */
function toPostCustomVars(row: PostCacheRow): PostCustomVars | null {
	const { targetedLeadMagnetId, followUpOneLeadMagnetId } = row;
	if (
		!(
			row.scraped &&
			row.source === "someone_else" &&
			targetedLeadMagnetId &&
			followUpOneLeadMagnetId
		)
	) {
		return null;
	}

	const targeted = getLeadMagnetById(targetedLeadMagnetId);
	const second = getLeadMagnetById(followUpOneLeadMagnetId);
	if (!(targeted && second)) {
		return null;
	}

	return {
		postername: derivePosterFirstName(row.posterName) ?? "",
		postlabel: targeted.postLabel,
		ourdescription: targeted.description,
		painline: targeted.painLine,
		seconddescription: second.description,
		secondpainline: second.painLine,
	};
}

/**
 * Someone-else flow: push one lead per Clay row into the configured Instantly
 * campaign, carrying the post's selected lead magnets as Instantly merge
 * variables (the templates fill `{{postername}}`/`{{postlabel}}`/etc.).
 *
 * Flow: drop leads with no email -> normalize and group by `originalPostUrl` ->
 * fetch cached posts via `post-cache/batch-get` -> fail with the exact URL list
 * if any post is missing, not fully scraped, or its magnet ids no longer resolve
 * -> add each lead with the post's merge variables plus its own `{{firstname}}`.
 * Pushing is not idempotent, so `maxAttempts` is 1; re-trigger manually on fail.
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
		const rowByUrl = new Map(rows.map((row) => [row.originalPostUrl, row]));

		const readyByUrl = new Map<string, PostCustomVars>();
		const missing: string[] = [];
		for (const url of normalizedUrls) {
			const row = rowByUrl.get(url);
			const postVars = row ? toPostCustomVars(row) : null;
			if (postVars) {
				readyByUrl.set(url, postVars);
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
			const postVars = readyByUrl.get(url);
			if (!postVars) {
				throw new Error(`Missing cached post for ${url}`);
			}

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
					firstname: getFirstName(lead.name),
					...postVars,
				},
			} satisfies InstantlyLead;
		});

		const result = await addLeadsToCampaign(instantlyLeads);
		logger.info("Pushed leads to Instantly", {
			added: result.added,
			skipped: result.skipped,
			leadCount: leads.length,
		});

		const closeLeads = emailLeads.map(
			(lead) =>
				({
					companyLinkedin: lead.companyLinkedin,
					companyName: lead.companyName,
					companyType: lead.staffinClassification,
					companyUrl: lead.companyUrl,
					contactName: lead.name,
					email: lead.email ?? "",
					personalLinkedinUrl: lead.personalLinkedinUrl,
				}) satisfies CloseLead
		);
		const closeResult = await addLeadsToClose(closeLeads);
		logger.info("Created leads in Close", {
			added: closeResult.added,
			skipped: closeResult.skipped,
			leadCount: leads.length,
		});

		return result;
	},
});
