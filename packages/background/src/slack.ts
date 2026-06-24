import type { ReplyIntent } from "./reply-suggestion";

const MAX_SLACK_ERROR_DETAIL_LENGTH = 500;
/** Reply / prior-message previews are clipped so a quoted thread can't bloat the card. */
const MAX_PREVIEW_LENGTH = 1500;
/** Slack caps a section block at 3000 chars; stay clear of the edge. */
const MAX_SECTION_LENGTH = 2900;

/** Per-intent Slack header. `:fire:` is reserved for genuinely hot replies. */
const HEADER_BY_INTENT: Record<ReplyIntent, string> = {
	interested: ":fire: Hot reply",
	maybe: ":eyes: Reply",
	not_interested: ":speech_balloon: Reply",
};

interface SlackMarkdownText {
	text: string;
	type: "mrkdwn";
}

interface SlackSectionBlock {
	text: SlackMarkdownText;
	type: "section";
}

export interface SlackWebhookPayload {
	blocks?: SlackSectionBlock[];
	text: string;
}

export interface SlackPostResult {
	status: number;
	statusText: string;
}

export class SlackWebhookError extends Error {
	readonly detail: string;
	readonly status: number;
	readonly statusText: string;

	constructor(response: SlackPostResult & { detail: string }) {
		const detail = response.detail
			.slice(0, MAX_SLACK_ERROR_DETAIL_LENGTH)
			.trim();
		const message =
			`Slack webhook failed (${response.status} ${response.statusText}): ${detail}`.trim();
		super(message);
		this.name = "SlackWebhookError";
		this.detail = detail;
		this.status = response.status;
		this.statusText = response.statusText;
	}
}

/**
 * Post a message payload to a Slack channel via its Incoming Webhook URL. Each
 * webhook URL is bound to one channel, so routing to a channel = picking the
 * URL. Slack answers `200 ok` on success and a 4xx with an error body
 * (`invalid_payload`, `no_service`, ...) on failure.
 */
export async function postSlackMessage(
	webhookUrl: string,
	payload: SlackWebhookPayload
): Promise<SlackPostResult> {
	const response = await fetch(webhookUrl, {
		body: JSON.stringify(payload),
		headers: { "content-type": "application/json" },
		method: "POST",
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new SlackWebhookError({
			detail,
			status: response.status,
			statusText: response.statusText,
		});
	}

	return {
		status: response.status,
		statusText: response.statusText,
	};
}

/** Escape the three characters Slack treats as mrkdwn control characters. */
function escapeSlackText(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

/** Clip overlong copy so one field can never blow a Slack block's char limit. */
function clampText(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** Lowercase domain of an email address, or "" when there is no usable domain. */
export function extractEmailDomain(email: string): string {
	const at = email.lastIndexOf("@");
	if (at === -1) {
		return "";
	}
	return email
		.slice(at + 1)
		.trim()
		.toLowerCase();
}

/** The reply, its context, and the drafted response for one Slack hot-reply card. */
export interface HotReplyMessage {
	campaignName: string;
	companyDomain: string;
	intent: ReplyIntent;
	priorMessage: string | null;
	replyText: string;
	suggestedResponse: string | null;
	uniboxUrl: string;
}

/**
 * Build the Slack notification for an Instantly reply. Mirrors the client's
 * format: an intent-tagged header with the campaign, the prospect's company
 * domain as a clickable link, the suggested response, the reply itself, the
 * prior message we sent for context, and a deep link into the Instantly Unibox.
 * Optional pieces (domain, suggestion, prior message, unibox) are dropped when
 * absent. Each line becomes its own section block; the joined text is the
 * notification fallback.
 */
export function buildHotReplyPayload(
	message: HotReplyMessage
): SlackWebhookPayload {
	const campaign = escapeSlackText(message.campaignName || "Unknown campaign");
	const sections: string[] = [
		`${HEADER_BY_INTENT[message.intent]}  -  ${campaign}`,
	];

	if (message.companyDomain) {
		sections.push(
			`:link: Company domain: <https://${message.companyDomain}|${escapeSlackText(message.companyDomain)}>`
		);
	}

	if (message.suggestedResponse) {
		sections.push(
			`:white_check_mark: Suggested response:\n${clampText(escapeSlackText(message.suggestedResponse), MAX_SECTION_LENGTH)}`
		);
	}

	sections.push(
		`:point_right: Reply:\n${escapeSlackText(clampText(message.replyText, MAX_PREVIEW_LENGTH))}`
	);

	if (message.priorMessage) {
		sections.push(
			`:point_right: Your prior message:\n${escapeSlackText(clampText(message.priorMessage, MAX_PREVIEW_LENGTH))}`
		);
	}

	if (message.uniboxUrl) {
		sections.push(`<${message.uniboxUrl}|Open in Instantly>`);
	}

	return {
		blocks: sections.map((text) => ({
			text: { text, type: "mrkdwn" },
			type: "section",
		})),
		text: sections.join("\n\n"),
	};
}
