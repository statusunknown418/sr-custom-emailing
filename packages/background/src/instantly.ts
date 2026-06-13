import { requireEnv } from "./process-env";

const INSTANTLY_LEADS_URL = "https://api.instantly.ai/api/v2/leads";

/** Max concurrent lead POSTs to Instantly, to stay clear of rate limits. */
const MAX_CONCURRENT_PUSHES = 5;

/**
 * A lead to add to the configured Instantly campaign. The post's selected lead
 * magnets travel as `customVariables` (`postername`, `postlabel`,
 * `ourdescription`, `painline`, `seconddescription`, `secondpainline`, plus the
 * per-lead `firstname`); the campaign's sequence steps reference them by name
 * (e.g. `{{postlabel}}`). Instantly fills its own `{{...}}` merge tags.
 */
export interface InstantlyLead {
	companyName: string;
	customVariables: Record<string, string>;
	email: string;
	firstName: string;
	lastName: string;
}

export interface AddLeadsToCampaignResult {
	added: number;
	skipped: number;
}

/** POST one lead into the campaign; throws with detail on a non-2xx response. */
async function pushLead(
	apiKey: string,
	campaignId: string,
	lead: InstantlyLead
): Promise<void> {
	const response = await fetch(INSTANTLY_LEADS_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			campaign: campaignId,
			email: lead.email,
			first_name: lead.firstName,
			last_name: lead.lastName,
			company_name: lead.companyName,
			custom_variables: lead.customVariables,
		}),
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(
			`Instantly create-lead failed for ${lead.email}: ${response.status} ${response.statusText} ${detail}`.trim()
		);
	}
}

/**
 * Add leads to the single Instantly campaign identified by
 * `INSTANTLY_CAMPAIGN_ID`, authenticating with `INSTANTLY_API_KEY`. Leads
 * without an email are skipped (Instantly requires one). Pushes run in bounded
 * concurrent batches; any failure aborts the run (the task is not retried, so
 * a partial push is surfaced rather than silently duplicated).
 */
export async function addLeadsToCampaign(
	leads: InstantlyLead[]
): Promise<AddLeadsToCampaignResult> {
	const apiKey = requireEnv("INSTANTLY_API_KEY");
	const campaignId = requireEnv("INSTANTLY_CAMPAIGN_ID");

	const writableLeads = leads.filter((lead) => lead.email.trim() !== "");
	const skipped = leads.length - writableLeads.length;

	for (let i = 0; i < writableLeads.length; i += MAX_CONCURRENT_PUSHES) {
		const chunk = writableLeads.slice(i, i + MAX_CONCURRENT_PUSHES);
		await Promise.all(chunk.map((lead) => pushLead(apiKey, campaignId, lead)));
	}

	return { added: writableLeads.length, skipped };
}
