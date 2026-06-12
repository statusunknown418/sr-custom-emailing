import { requireEnv } from "./process-env";

const CLOSE_LEADS_URL = "https://api.close.com/api/v1/lead/";

/** Max concurrent lead POSTs to Close, to stay clear of rate limits. */
const MAX_CONCURRENT_PUSHES = 5;

/**
 * Lead Source choice stamped on every lead this pipeline creates. Must match an
 * existing option on Close's "Lead Source" custom field, or the POST 400s.
 */
const LEAD_SOURCE = "Lead Scraping";

// Org-specific Close custom-field ids, taken from the live lead payloads. Three
// live on the lead, one on its contact. A value is only sent when non-empty, so
// an empty string never lands on a choice field and trips a 400.
const COMPANY_LINKEDIN_FIELD = "cf_ZberkZqPiuVI6uMAhDKI0r54DZet2L6O7bUOIF9D4AE";
const LEAD_SOURCE_FIELD = "cf_qOzC7bCEgBxS4ye3vC2lzzfs0LH4YODOjXLQobLQz8A";
const COMPANY_TYPE_FIELD = "cf_qxE5jqgIje0UZEXPPacIuh2AacO08IoqzCxcfG1m5UQ";
const CONTACT_LINKEDIN_FIELD = "cf_y9LwRgYn7fPr3uUQiGNx4fFgqv24Nzbm4CIAxbFzHyd";

/**
 * One lead to create in Close. Maps the Clay-enriched fields we hold to a plain
 * Close lead (no opportunity / pipeline): the company is the lead, the prospect
 * its single contact. Empty optional fields are dropped from the request.
 */
export interface CloseLead {
	companyLinkedin: string;
	companyName: string;
	companyType: string;
	companyUrl: string;
	contactName: string;
	email: string;
	personalLinkedinUrl: string;
}

export interface AddLeadsToCloseResult {
	added: number;
	skipped: number;
}

/** Build the Close create-lead body, omitting every empty optional field. */
function buildLeadBody(lead: CloseLead): Record<string, unknown> {
	const contact: Record<string, unknown> = {
		emails: [{ email: lead.email, type: "work" }],
	};
	if (lead.contactName.trim()) {
		contact.name = lead.contactName;
	}
	if (lead.personalLinkedinUrl.trim()) {
		contact[`custom.${CONTACT_LINKEDIN_FIELD}`] = lead.personalLinkedinUrl;
	}

	const body: Record<string, unknown> = {
		contacts: [contact],
		[`custom.${LEAD_SOURCE_FIELD}`]: LEAD_SOURCE,
	};
	if (lead.companyName.trim()) {
		body.name = lead.companyName;
	}
	if (lead.companyUrl.trim()) {
		body.url = lead.companyUrl;
	}
	if (lead.companyLinkedin.trim()) {
		body[`custom.${COMPANY_LINKEDIN_FIELD}`] = lead.companyLinkedin;
	}
	if (lead.companyType.trim()) {
		body[`custom.${COMPANY_TYPE_FIELD}`] = [lead.companyType];
	}

	return body;
}

/** POST one lead into Close; throws with detail on a non-2xx response. */
async function pushLead(authHeader: string, lead: CloseLead): Promise<void> {
	const response = await fetch(CLOSE_LEADS_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: authHeader,
		},
		body: JSON.stringify(buildLeadBody(lead)),
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		const label = lead.email.trim() || lead.companyName.trim();
		throw new Error(
			`Close create-lead failed for ${label}: ${response.status} ${response.statusText} ${detail}`.trim()
		);
	}
}

/**
 * Create each lead in Close as a plain lead (no opportunity / pipeline). Auth is
 * `CLOSE_ENCODED_API_KEY` — the pre-base64-encoded `apikey:` HTTP Basic
 * credential — sent verbatim as `Basic <value>`. A lead with neither an email
 * nor a company name is skipped (Close would reject it). Pushes run in bounded
 * concurrent batches; any failure aborts the run (the task is not retried, so a
 * partial push is surfaced rather than silently duplicated).
 */
export async function addLeadsToClose(
	leads: CloseLead[]
): Promise<AddLeadsToCloseResult> {
	const authHeader = `Basic ${requireEnv("CLOSE_ENCODED_API_KEY")}`;

	const writableLeads = leads.filter(
		(lead) => lead.email.trim() || lead.companyName.trim()
	);
	const skipped = leads.length - writableLeads.length;

	for (let i = 0; i < writableLeads.length; i += MAX_CONCURRENT_PUSHES) {
		const chunk = writableLeads.slice(i, i + MAX_CONCURRENT_PUSHES);
		await Promise.all(chunk.map((lead) => pushLead(authHeader, lead)));
	}

	return { added: writableLeads.length, skipped };
}
