import { tasks } from "@trigger.dev/sdk";

import type { commentTrackingGenerate } from "./trigger/comment-tracking-generate.task";
import type { commentTrackingScrape } from "./trigger/comment-tracking-scrape.task";
import type { forwardCommentersToClay } from "./trigger/forward-commenters-to-clay.task";
import type { harvestCommenters } from "./trigger/harvest-commenters.task";
import type { instantlyReplyNotify } from "./trigger/instantly-reply-notify.task";
import type { someoneElseGenerate } from "./trigger/someone-else-generate.task";
import type { someoneElseScrape } from "./trigger/someone-else-scrape.task";
import {
	type ForwardCommentersPayload,
	forwardCommentersPayloadSchema,
	type HarvestCommentersPayload,
	harvestCommentersPayloadSchema,
	type InstantlyReplyNotifyPayload,
	instantlyReplyNotifyPayloadSchema,
	type LeadBatchPayload,
	leadBatchPayloadSchema,
	type ScrapePostPayload,
	scrapePostPayloadSchema,
} from "./types";

export type {
	ClayLead,
	ForwardCommentersPayload,
	HarvestCommentersPayload,
	InstantlyReplyNotifyPayload,
	LeadBatchPayload,
	PostSource,
	ScrapePostPayload,
} from "./types";
export {
	clayLeadSchema,
	forwardCommentersPayloadSchema,
	harvestCommentersPayloadSchema,
	instantlyReplyNotifyPayloadSchema,
	leadBatchPayloadSchema,
	scrapePostPayloadSchema,
} from "./types";

/** Handle returned after enqueuing a Trigger task. */
export interface TriggerTaskResult {
	id: string;
}

/** Enqueue the comment-tracking scrape task (our post -> DM template). */
export async function triggerCommentTrackingScrape(
	payload: ScrapePostPayload
): Promise<TriggerTaskResult> {
	const parsedPayload = scrapePostPayloadSchema.parse(payload);
	const handle = await tasks.trigger<typeof commentTrackingScrape>(
		"comment-tracking-scrape",
		parsedPayload
	);

	return { id: handle.id };
}

/** Enqueue the comment-tracking generate task (leads -> DM rows in the Sheet). */
export async function triggerCommentTrackingGenerate(
	payload: LeadBatchPayload
): Promise<TriggerTaskResult> {
	const parsedPayload = leadBatchPayloadSchema.parse(payload);
	const handle = await tasks.trigger<typeof commentTrackingGenerate>(
		"comment-tracking-generate",
		parsedPayload
	);

	return { id: handle.id };
}

/** Enqueue the someone-else scrape task (their post -> email template). */
export async function triggerSomeoneElseScrape(
	payload: ScrapePostPayload
): Promise<TriggerTaskResult> {
	const parsedPayload = scrapePostPayloadSchema.parse(payload);
	const handle = await tasks.trigger<typeof someoneElseScrape>(
		"someone-else-scrape",
		parsedPayload
	);

	return { id: handle.id };
}

/** Enqueue the someone-else generate task (leads -> Instantly campaign). */
export async function triggerSomeoneElseGenerate(
	payload: LeadBatchPayload
): Promise<TriggerTaskResult> {
	const parsedPayload = leadBatchPayloadSchema.parse(payload);
	const handle = await tasks.trigger<typeof someoneElseGenerate>(
		"someone-else-generate",
		parsedPayload
	);

	return { id: handle.id };
}

/** Enqueue the commenter harvest task (post -> Apify comments -> webhook -> Clay). */
export async function triggerHarvestCommenters(
	payload: HarvestCommentersPayload
): Promise<TriggerTaskResult> {
	const parsedPayload = harvestCommentersPayloadSchema.parse(payload);
	const handle = await tasks.trigger<typeof harvestCommenters>(
		"harvest-commenters",
		parsedPayload
	);

	return { id: handle.id };
}

/** Enqueue the Clay-forward task for a finished commenter run (from the webhook). */
export async function triggerForwardCommentersToClay(
	payload: ForwardCommentersPayload
): Promise<TriggerTaskResult> {
	const parsedPayload = forwardCommentersPayloadSchema.parse(payload);
	const handle = await tasks.trigger<typeof forwardCommentersToClay>(
		"forward-commenters-to-clay",
		parsedPayload
	);

	return { id: handle.id };
}

/** Enqueue the Instantly reply notification task (reply -> Slack hot-reply card). */
export async function triggerInstantlyReplyNotify(
	payload: InstantlyReplyNotifyPayload
): Promise<TriggerTaskResult> {
	const parsedPayload = instantlyReplyNotifyPayloadSchema.parse(payload);
	const handle = await tasks.trigger<typeof instantlyReplyNotify>(
		"instantly-reply-notify",
		parsedPayload
	);

	return { id: handle.id };
}
