import { requireEnv } from "./process-env";

const INSTANTLY_LEADS_URL = "https://api.instantly.ai/api/v2/leads";

/** Max concurrent lead POSTs to Instantly, to stay clear of rate limits. */
const MAX_CONCURRENT_PUSHES = 5;

/**
 * A lead to add to the configured Instantly campaign. The post's selected lead
 * magnet sequence travels as `customVariables` (`posterfullname`, `postlabel`,
 * `article`, `what`, `solvesthis`, `painline`, `followup1article`,
 * `followup1what`, `followup1solvesthis`, `followup1painline`,
 * `followup2article`, `followup2what`, `followup2solvesthis`,
 * `followup2painline`, plus the per-lead `firstname`); the campaign's sequence
 * steps reference them by name (e.g. `{{postlabel}}`). Instantly fills its own
 * `{{...}}` merge tags.
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

const INSTANTLY_EMAILS_URL = "https://api.instantly.ai/api/v2/emails";

/** One email returned by the Instantly list-emails endpoint (fields we read). */
interface InstantlyEmail {
	body?: { html?: string; text?: string };
	timestamp_created?: string;
	timestamp_email?: string;
}

interface ListEmailsResponse {
	items?: InstantlyEmail[];
}

/** Epoch millis of an email's send time, or 0 when no timestamp parses. */
function emailSentAt(email: InstantlyEmail): number {
	const raw = email.timestamp_email ?? email.timestamp_created ?? "";
	const parsed = Date.parse(raw);
	return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Fetch the most recent message WE sent to a lead in a campaign - the "your
 * prior message" context for the hot-reply Slack notification and the
 * suggested-reply draft. Instantly's `reply_received` webhook carries only the
 * prospect's reply, so the prior step is pulled from the emails API here.
 *
 * Returns the plain-text body of the latest sent email, or `null` when none is
 * found. Throws on a non-2xx response; the notify task treats a failure as
 * best-effort and posts without the prior message rather than dropping it.
 */
export async function fetchLastSentMessage(input: {
	campaignId: string;
	leadEmail: string;
}): Promise<string | null> {
	const apiKey = requireEnv("INSTANTLY_API_KEY");

	const url = new URL(INSTANTLY_EMAILS_URL);
	url.searchParams.set("preview_only", "false");
	url.searchParams.set("email_type", "sent");
	url.searchParams.set("campaign_id", input.campaignId);
	url.searchParams.set("lead", input.leadEmail);

	const response = await fetch(url, {
		headers: { authorization: `Bearer ${apiKey}` },
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(
			`Instantly list-emails failed for ${input.leadEmail}: ${response.status} ${response.statusText} ${detail}`.trim()
		);
	}

	const data = (await response.json()) as ListEmailsResponse;
	const items = Array.isArray(data.items) ? data.items : [];
	if (items.length === 0) {
		return null;
	}

	const latest = items.reduce((best, current) =>
		emailSentAt(current) > emailSentAt(best) ? current : best
	);
	const text = latest.body?.text?.trim();
	return text ? text : null;
}
