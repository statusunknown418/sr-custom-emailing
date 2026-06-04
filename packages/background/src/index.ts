import { tasks } from "@trigger.dev/sdk";
import type { emailGeneration } from "./trigger/email-generation.task";
import type { scrapePost } from "./trigger/scrape-post.task";
import {
	type EmailGenerationPayload,
	emailGenerationPayloadSchema,
	type ScrapePostPayload,
	scrapePostPayloadSchema,
} from "./types";

export type {
	ClayLead,
	EmailGenerationPayload,
	ScrapePostPayload,
	StartLinkedinScrapingPayload,
} from "./types";
export {
	clayLeadSchema,
	emailGenerationPayloadSchema,
	scrapePostPayloadSchema,
	startLinkedinScrapingPayloadSchema,
} from "./types";

/** Handle returned after enqueuing a Trigger task. */
export interface TriggerTaskResult {
	id: string;
}

/** Enqueue the `scrape-post` task for one LinkedIn post URL. */
export async function triggerScrapePost(
	payload: ScrapePostPayload
): Promise<TriggerTaskResult> {
	const parsedPayload = scrapePostPayloadSchema.parse(payload);
	const handle = await tasks.trigger<typeof scrapePost>(
		"scrape-post",
		parsedPayload
	);

	return { id: handle.id };
}

/** Enqueue the `email-generation` task for a batch of Clay leads. */
export async function triggerEmailGeneration(
	payload: EmailGenerationPayload
): Promise<TriggerTaskResult> {
	const parsedPayload = emailGenerationPayloadSchema.parse(payload);
	const handle = await tasks.trigger<typeof emailGeneration>(
		"email-generation",
		parsedPayload
	);

	return { id: handle.id };
}
