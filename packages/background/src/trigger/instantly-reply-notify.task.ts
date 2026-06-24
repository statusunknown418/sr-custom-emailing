import { logger, schemaTask } from "@trigger.dev/sdk";

import { fetchLastSentMessage } from "../instantly";
import { generateReplySuggestion, type ReplyIntent } from "../reply-suggestion";
import {
	buildHotReplyPayload,
	extractEmailDomain,
	postSlackMessage,
} from "../slack";
import { instantlyReplyNotifyPayloadSchema } from "../types";

/**
 * Draft and post an Instantly reply to its campaign's Slack channel. Enqueued by
 * the `/instantly/replies` webhook once a real human reply clears the edge
 * filters (the Worker already resolved the channel webhook URL and routed it
 * here, so this task does no routing).
 *
 * Steps: pull the prior message we sent (Instantly's webhook omits it) ->
 * classify intent and draft Alex's reply with Claude -> post the formatted card
 * to Slack. The prior-message fetch and the draft are best-effort: a failure in
 * either degrades the card (missing context / missing suggestion) but never
 * drops the notification. Only a failed Slack post throws, so Trigger's retries
 * cover transient Slack errors; the post is the last step, so a retry cannot
 * double-post.
 */
export const instantlyReplyNotify = schemaTask({
	id: "instantly-reply-notify",
	retry: { maxAttempts: 3 },
	schema: instantlyReplyNotifyPayloadSchema,
	run: async (payload) => {
		const {
			campaignId,
			campaignName,
			leadEmail,
			replyText,
			slackWebhookUrl,
			uniboxUrl,
			workspace,
		} = payload;

		const priorMessage = await fetchLastSentMessage({
			campaignId,
			leadEmail,
			workspace,
		}).catch((error: unknown) => {
			logger.warn("Could not fetch prior Instantly message", {
				error: error instanceof Error ? error.message : String(error),
				leadEmail,
				workspace,
			});
			return null;
		});

		let intent: ReplyIntent = "maybe";
		let suggestedResponse: string | null = null;
		try {
			const suggestion = await generateReplySuggestion({
				campaignName,
				priorMessage,
				replyText,
			});
			intent = suggestion.intent;
			suggestedResponse = suggestion.suggestedResponse;
		} catch (error) {
			logger.error("Could not draft reply suggestion", {
				error: error instanceof Error ? error.message : String(error),
				leadEmail,
			});
		}

		const result = await postSlackMessage(
			slackWebhookUrl,
			buildHotReplyPayload({
				campaignName,
				companyDomain: extractEmailDomain(leadEmail),
				intent,
				priorMessage,
				replyText,
				suggestedResponse,
				uniboxUrl,
			})
		);

		logger.info("Posted Instantly reply notification to Slack", {
			drafted: suggestedResponse !== null,
			hadPriorMessage: priorMessage !== null,
			intent,
			leadEmail,
			status: result.status,
		});

		return { intent, posted: true };
	},
});
