import { notifyInstantlyReply } from "@sr-custom-emailing/api/instantly-reply-service";
import { env } from "@sr-custom-emailing/env/server";
import type { RequestLogger } from "evlog";
import type { EvlogVariables } from "evlog/hono";
import type { Context } from "hono";
import { safeEqual } from "./http-auth";

const AUTH_HEADER = "authorization";
const AUTH_SCHEME_RE = /^(?:basic|bearer)\s+/i;
const REPLY_RECEIVED_EVENT = "reply_received";
const SLACK_NOTIFICATION_ENDPOINT = "/instantly/replies";
const SLACK_NOTIFICATION_FLOW = "instantly_reply_notification";

/**
 * Out-of-office / vacation auto-responders. Filtered at the edge so they never
 * spawn a notification task - no human replied, there is nothing to draft.
 */
const AUTO_REPLY_RE =
	/\b(out of office|ooo|automatic reply|auto-?reply|away from (?:the )?office|on vacation|annual leave|maternity leave|parental leave|currently unavailable)\b/i;

type InstantlyReplyPayload = Record<string, unknown>;

type InstantlyReplyContext = Context<EvlogVariables>;

type SlackNotificationStatus = "enqueued" | "failed" | "received" | "skipped";

interface CampaignSlackWebhookConfig {
	error?: string;
	webhooks: Record<string, string>;
}

interface SlackNotificationEvent {
	campaignId?: string;
	campaignName?: string;
	configError?: string;
	eventType?: string;
	leadEmail?: string;
	reason?: string;
	status: SlackNotificationStatus;
	taskId?: string;
}

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
 * not posted) rather than crashing the route. The Worker is the single source of
 * this map; the resolved URL travels in the notify task's payload.
 */
const CAMPAIGN_SLACK_WEBHOOK_CONFIG = readCampaignSlackWebhookConfig();

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function readCampaignSlackWebhookConfig(): CampaignSlackWebhookConfig {
	try {
		const parsed = JSON.parse(env.INSTANTLY_CAMPAIGN_SLACK_WEBHOOKS) as unknown;
		if (
			parsed === null ||
			typeof parsed !== "object" ||
			Array.isArray(parsed)
		) {
			return {
				error: "INSTANTLY_CAMPAIGN_SLACK_WEBHOOKS must be a JSON object",
				webhooks: {},
			};
		}

		const invalidKeys: string[] = [];
		const webhooks: Record<string, string> = {};

		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "string" && value.trim() !== "") {
				webhooks[key] = value;
			} else {
				invalidKeys.push(key);
			}
		}

		return {
			error:
				invalidKeys.length > 0
					? `INSTANTLY_CAMPAIGN_SLACK_WEBHOOKS has invalid entries: ${invalidKeys.join(", ")}`
					: undefined,
			webhooks,
		};
	} catch (error) {
		return {
			error: `Invalid INSTANTLY_CAMPAIGN_SLACK_WEBHOOKS JSON: ${getErrorMessage(error)}`,
			webhooks: {},
		};
	}
}

function recordSlackNotificationEvent(
	log: RequestLogger,
	event: SlackNotificationEvent
): void {
	log.set({
		slack: {
			notification: {
				endpoint: SLACK_NOTIFICATION_ENDPOINT,
				flow: SLACK_NOTIFICATION_FLOW,
				...event,
			},
		},
	});
}

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

/**
 * Single Instantly `reply_received` webhook endpoint for every campaign. Routes
 * a reply to its campaign's Slack channel by resolving the channel webhook URL
 * from `INSTANTLY_CAMPAIGN_SLACK_WEBHOOKS`, then enqueues the
 * `instantly-reply-notify` task to draft Alex's response and post the formatted
 * card. The Worker does the cheap edge work only (secret check, event filter,
 * channel routing, auto-reply filter); intent classification, the prior-message
 * fetch, and the suggested-reply draft happen in the task, which is why the
 * route acks fast - Instantly recommends async processing for this event.
 */
export async function handleInstantlyReplyWebhook(
	c: InstantlyReplyContext
): Promise<Response> {
	const log = c.get("log");
	const expectedSecret = env.INSTANTLY_WEBHOOK_SECRET;
	const providedSecret = c.req.header(AUTH_HEADER)?.replace(AUTH_SCHEME_RE, "");

	recordSlackNotificationEvent(log, { status: "received" });

	if (CAMPAIGN_SLACK_WEBHOOK_CONFIG.error) {
		log.error("Invalid Slack webhook mapping config", {
			slack: {
				notification: {
					configError: CAMPAIGN_SLACK_WEBHOOK_CONFIG.error,
					endpoint: SLACK_NOTIFICATION_ENDPOINT,
					flow: SLACK_NOTIFICATION_FLOW,
					status: "failed",
				},
			},
		});
	}

	if (
		!expectedSecret ||
		providedSecret === undefined ||
		!safeEqual(providedSecret, expectedSecret)
	) {
		log.warn("Instantly Slack notification rejected", {
			slack: {
				notification: {
					endpoint: SLACK_NOTIFICATION_ENDPOINT,
					flow: SLACK_NOTIFICATION_FLOW,
					reason: "invalid_webhook_secret",
					status: "skipped",
				},
			},
		});
		return c.text("invalid webhook secret", 401);
	}

	const payload = (await c.req
		.json()
		.catch(() => null)) as InstantlyReplyPayload | null;
	if (payload === null) {
		log.warn("Instantly Slack notification rejected", {
			slack: {
				notification: {
					endpoint: SLACK_NOTIFICATION_ENDPOINT,
					flow: SLACK_NOTIFICATION_FLOW,
					reason: "invalid_json",
					status: "skipped",
				},
			},
		});
		return c.text("invalid json", 400);
	}

	const eventType = readString(payload, "event_type", "eventType");
	const details = extractReplyDetails(payload);
	if (eventType !== REPLY_RECEIVED_EVENT) {
		recordSlackNotificationEvent(log, {
			campaignId: details.campaignId,
			campaignName: details.campaignName,
			eventType,
			leadEmail: details.leadEmail,
			reason: "ignored_event",
			status: "skipped",
		});
		log.info("Instantly Slack notification skipped");
		return c.json({ enqueued: false, ok: true, reason: "ignored_event" });
	}

	const slackWebhookUrl =
		CAMPAIGN_SLACK_WEBHOOK_CONFIG.webhooks[details.campaignId] ??
		CAMPAIGN_SLACK_WEBHOOK_CONFIG.webhooks[details.campaignName];

	recordSlackNotificationEvent(log, {
		campaignId: details.campaignId,
		campaignName: details.campaignName,
		eventType,
		leadEmail: details.leadEmail,
		status: "received",
	});

	if (!slackWebhookUrl) {
		recordSlackNotificationEvent(log, {
			campaignId: details.campaignId,
			campaignName: details.campaignName,
			configError: CAMPAIGN_SLACK_WEBHOOK_CONFIG.error,
			eventType,
			leadEmail: details.leadEmail,
			reason: "unmapped_campaign",
			status: "skipped",
		});
		log.warn("Instantly reply campaign not mapped to Slack");
		return c.json({ enqueued: false, ok: true, reason: "unmapped_campaign" });
	}

	if (!details.replyText || AUTO_REPLY_RE.test(details.replyText)) {
		recordSlackNotificationEvent(log, {
			campaignId: details.campaignId,
			campaignName: details.campaignName,
			eventType,
			leadEmail: details.leadEmail,
			reason: "auto_reply",
			status: "skipped",
		});
		log.info("Instantly Slack notification skipped");
		return c.json({ enqueued: false, ok: true, reason: "auto_reply" });
	}

	try {
		const { taskId } = await notifyInstantlyReply({
			campaignId: details.campaignId,
			campaignName: details.campaignName,
			leadEmail: details.leadEmail,
			replySubject: details.replySubject,
			replyText: details.replyText,
			slackWebhookUrl,
			uniboxUrl: details.uniboxUrl,
		});
		recordSlackNotificationEvent(log, {
			campaignId: details.campaignId,
			campaignName: details.campaignName,
			eventType,
			leadEmail: details.leadEmail,
			status: "enqueued",
			taskId,
		});
		log.info("Instantly reply notification enqueued");
		return c.json({ enqueued: true, ok: true, taskId });
	} catch (error) {
		recordSlackNotificationEvent(log, {
			campaignId: details.campaignId,
			campaignName: details.campaignName,
			eventType,
			leadEmail: details.leadEmail,
			status: "failed",
		});
		log.error(error instanceof Error ? error : getErrorMessage(error), {
			slack: {
				notification: {
					campaignId: details.campaignId,
					campaignName: details.campaignName,
					endpoint: SLACK_NOTIFICATION_ENDPOINT,
					flow: SLACK_NOTIFICATION_FLOW,
					leadEmail: details.leadEmail,
					status: "failed",
				},
			},
		});
		throw error;
	}
}
