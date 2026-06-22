import { env } from "@sr-custom-emailing/env/server";
import type { Context } from "hono";
import { safeEqual } from "./http-auth";
import { postSlackMessage } from "./slack";

const AUTH_HEADER = "authorization";
const AUTH_SCHEME_RE = /^(?:basic|bearer)\s+/i;
const REPLY_RECEIVED_EVENT = "reply_received";
const MAX_REPLY_PREVIEW_LENGTH = 1500;

const AUTO_REPLY_RE =
	/\b(out of office|ooo|automatic reply|auto-?reply|away from (?:the )?office|on vacation|annual leave|maternity leave|parental leave|currently unavailable)\b/i;
const YES_REPLY_RE =
	/\b(yes|yeah|yep|interested|sounds good|send (?:it|details|more)|let'?s talk|book|schedule|calendar|open to|tell me more)\b/i;
const NO_REPLY_RE =
	/\b(no|nope|not interested|unsubscribe|remove me|stop emailing|not now|no thanks|pass|not a fit|don'?t contact)\b/i;

type ReplyIntent = "yes" | "no" | "unclear";

type InstantlyReplyPayload = Record<string, unknown>;

interface ReplyDetails {
	campaignId: string;
	campaignName: string;
	leadEmail: string;
	replySubject: string;
	replyText: string;
	uniboxUrl: string;
}

/**
 * Campaign -> Slack channel routing, parsed once from the
 * `INSTANTLY_CAMPAIGN_SLACK_WEBHOOKS` JSON env var. Keys may be a campaign id or
 * a campaign name (both are looked up); values are that channel's Slack Incoming
 * Webhook URL. A malformed value yields an empty map (every reply is acked but
 * not posted) rather than crashing the route.
 */
const CAMPAIGN_SLACK_WEBHOOKS: Record<string, string> = (() => {
	try {
		const parsed = JSON.parse(env.INSTANTLY_CAMPAIGN_SLACK_WEBHOOKS) as unknown;
		if (parsed === null || typeof parsed !== "object") {
			return {};
		}
		return parsed as Record<string, string>;
	} catch (error) {
		console.error("Invalid INSTANTLY_CAMPAIGN_SLACK_WEBHOOKS json", { error });
		return {};
	}
})();

function readString(
	payload: InstantlyReplyPayload,
	...fieldNames: string[]
): string {
	for (const fieldName of fieldNames) {
		const value = payload[fieldName];
		if (typeof value === "string" && value.trim() !== "") {
			return value.trim();
		}
	}
	return "";
}

function extractReplyDetails(payload: InstantlyReplyPayload): ReplyDetails {
	return {
		campaignId: readString(payload, "campaign_id", "campaignId", "campaign"),
		campaignName: readString(payload, "campaign_name", "campaignName"),
		leadEmail: readString(payload, "lead_email", "email", "leadEmail"),
		replySubject: readString(
			payload,
			"reply_subject",
			"replySubject",
			"subject"
		),
		replyText: readString(
			payload,
			"reply_text",
			"replyText",
			"reply_text_snippet",
			"replyTextSnippet"
		),
		uniboxUrl: readString(payload, "unibox_url", "uniboxUrl"),
	};
}

function classifyReply(replyText: string): ReplyIntent {
	const isYes = YES_REPLY_RE.test(replyText);
	const isNo = NO_REPLY_RE.test(replyText);

	if (isYes === isNo) {
		return "unclear";
	}

	return isYes ? "yes" : "no";
}

function truncateReply(replyText: string): string {
	if (replyText.length <= MAX_REPLY_PREVIEW_LENGTH) {
		return replyText;
	}

	return `${replyText.slice(0, MAX_REPLY_PREVIEW_LENGTH)}…`;
}

function buildSlackText(
	intent: Exclude<ReplyIntent, "unclear">,
	details: ReplyDetails
): string {
	const rows = [
		`New Instantly reply: ${intent.toUpperCase()}`,
		`Campaign: ${details.campaignName || details.campaignId || "Unknown"}`,
		`Lead: ${details.leadEmail || "Unknown"}`,
		`Subject: ${details.replySubject || "Unknown"}`,
		`Reply: ${truncateReply(details.replyText)}`,
	];

	if (details.uniboxUrl) {
		rows.push(`Instantly: ${details.uniboxUrl}`);
	}

	return rows
		.join("\n")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

/**
 * Single Instantly `reply_received` webhook endpoint for every campaign. Routes
 * to the right Slack channel by matching the payload's campaign id (then name)
 * against `INSTANTLY_CAMPAIGN_SLACK_CHANNELS`. Auto replies, unclear replies, and
 * unmapped campaigns are acked with 200 but not posted so Instantly does not
 * retry noise.
 */
export async function handleInstantlyReplyWebhook(
	c: Context
): Promise<Response> {
	const expectedSecret = env.INSTANTLY_WEBHOOK_SECRET;
	const providedSecret = c.req.header(AUTH_HEADER)?.replace(AUTH_SCHEME_RE, "");
	if (
		!expectedSecret ||
		providedSecret === undefined ||
		!safeEqual(providedSecret, expectedSecret)
	) {
		return c.text("invalid webhook secret", 401);
	}

	const payload = (await c.req
		.json()
		.catch(() => null)) as InstantlyReplyPayload | null;
	if (payload === null) {
		return c.text("invalid json", 400);
	}

	const eventType = readString(payload, "event_type", "eventType");
	if (eventType !== REPLY_RECEIVED_EVENT) {
		return c.json({ forwarded: false, ok: true, reason: "ignored_event" });
	}

	const details = extractReplyDetails(payload);
	const slackWebhookUrl =
		CAMPAIGN_SLACK_WEBHOOKS[details.campaignId] ??
		CAMPAIGN_SLACK_WEBHOOKS[details.campaignName];
	if (!slackWebhookUrl) {
		console.error("Instantly reply campaign not mapped to a Slack channel", {
			campaignId: details.campaignId,
			campaignName: details.campaignName,
		});
		return c.json({ forwarded: false, ok: true, reason: "unmapped_campaign" });
	}

	if (!details.replyText || AUTO_REPLY_RE.test(details.replyText)) {
		return c.json({ forwarded: false, ok: true, reason: "auto_reply" });
	}

	const intent = classifyReply(details.replyText);
	if (intent === "unclear") {
		return c.json({ forwarded: false, ok: true, reason: "unclear_reply" });
	}

	await postSlackMessage(slackWebhookUrl, buildSlackText(intent, details));

	return c.json({ forwarded: true, intent, ok: true });
}
