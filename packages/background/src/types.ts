import { z } from "zod";

/**
 * Which flow owns a cached post row. `comment_tracking` rows carry the 3
 * LinkedIn DM bodies; `someone_else` rows carry the 3-email sequence pushed to
 * Instantly. Both share the scrape + magnet-selection columns.
 */
export const POST_SOURCES = ["comment_tracking", "someone_else"] as const;
export const postSourceSchema = z.enum(POST_SOURCES);
export type PostSource = z.infer<typeof postSourceSchema>;

export const STAFFING_FIRM_CLASSIFICATION = "staffing_firm" as const;

/** Public API input + Trigger task payload: scrape one LinkedIn post. */
export const scrapePostPayloadSchema = z.object({
	originalPostUrl: z.string().min(1),
});

export type ScrapePostPayload = z.infer<typeof scrapePostPayloadSchema>;

/**
 * Trigger payload for `harvest-commenters`: harvest the commenters on one
 * LinkedIn post for a given flow. `flow` is the flag carried through Apify ->
 * our webhook -> Clay so the enriched leads route back to the matching generate
 * endpoint.
 */
export const harvestCommentersPayloadSchema = z.object({
	flow: postSourceSchema,
	originalPostUrl: z.string().min(1),
});

export type HarvestCommentersPayload = z.infer<
	typeof harvestCommentersPayloadSchema
>;

/**
 * Trigger payload for `forward-commenters-to-clay`: emitted by the Apify
 * webhook route once a commenter run finishes. Identifies the run's dataset and
 * the flow so the task can fetch the commenters and forward them to Clay.
 */
export const forwardCommentersPayloadSchema = z.object({
	datasetId: z.string().min(1),
	flow: postSourceSchema,
	originalPostUrl: z.string().min(1),
});

export type ForwardCommentersPayload = z.infer<
	typeof forwardCommentersPayloadSchema
>;

/** Normalize a missing/null/undefined Clay field to "". */
const flexString = z
	.string()
	.nullish()
	.transform((value) => value ?? "");

/**
 * A single lead row delivered by Clay. Only `originalPostUrl` is required (it
 * links the lead to its cached post). `email` is nullish (the Instantly flow
 * drops emailless leads; the comment-tracking flow drops leads without a
 * LinkedIn URL instead). Every other field tolerates a missing/null value from
 * Clay's enrichment and normalizes to "" so a partial lead never crashes the
 * run; downstream consumers always receive strings.
 */
export const clayLeadSchema = z.object({
	email: z.string().nullish(),
	staffinClassification: flexString,
	companyName: flexString,
	companyUrl: flexString,
	companyLinkedin: flexString,
	companyEmployees: flexString,
	companyIndustry: flexString,
	companyDescription: flexString,
	name: flexString,
	country: flexString,
	originalComment: flexString,
	originalPostUrl: z.string().min(1),
	personalLinkedinUrl: flexString,
});

export type ClayLead = z.infer<typeof clayLeadSchema>;

export function isStaffingFirmLead(
	lead: Pick<ClayLead, "staffinClassification">
): boolean {
	const classification = lead.staffinClassification.trim().toLowerCase();

	return (
		classification === STAFFING_FIRM_CLASSIFICATION ||
		classification === "staffing firm"
	);
}

/**
 * Public API input + Trigger task payload for both generate flows: a batch of
 * at least one lead. Each flow enforces its own per-lead requirement (LinkedIn
 * URL for DMs, email for Instantly) at runtime.
 */
export const leadBatchPayloadSchema = z.object({
	leads: z.array(clayLeadSchema).min(1),
});

export type LeadBatchPayload = z.infer<typeof leadBatchPayloadSchema>;

/**
 * Trigger payload for `instantly-reply-notify`: emitted by the Instantly reply
 * webhook once a genuine human reply clears the edge filters. Carries the Slack
 * Incoming Webhook URL already resolved for the reply's campaign channel (the
 * Worker stays the single source of the campaign -> channel map) plus the reply
 * context. Intent classification and the suggested-reply draft happen in the
 * task, not the Worker.
 */
export const instantlyReplyNotifyPayloadSchema = z.object({
	campaignId: z.string(),
	campaignName: z.string(),
	leadEmail: z.string(),
	replySubject: z.string(),
	replyText: z.string().min(1),
	slackWebhookUrl: z.string().min(1),
	uniboxUrl: z.string(),
});

export type InstantlyReplyNotifyPayload = z.infer<
	typeof instantlyReplyNotifyPayloadSchema
>;

/** Scrape + magnet-selection fields common to every cache update. */
const postCacheUpdateBase = {
	originalPostUrl: z.string().min(1),
	postContent: z.string().min(1),
	posterName: z.string().nullish(),
	posterLeadMagnet: z.string().min(1),
	targetedLeadMagnetId: z.string().min(1),
	followUpOneLeadMagnetId: z.string().min(1),
	followUpTwoLeadMagnetId: z.string().min(1),
};

/**
 * Body for the internal `post-cache/update` endpoint, discriminated on
 * `source`. The `comment_tracking` variant carries the 2 DM bodies; the
 * `someone_else` variant carries the 6 email template fields. Required string
 * fields are `.min(1)` so a row is never cached half-written.
 */
export const postCacheUpdatePayloadSchema = z.discriminatedUnion("source", [
	z.object({
		...postCacheUpdateBase,
		source: z.literal("comment_tracking"),
		dm1Body: z.string().min(1),
		dm2Body: z.string().min(1),
	}),
	z.object({
		...postCacheUpdateBase,
		source: z.literal("someone_else"),
		email1Subject: z.string().min(1),
		email1Body: z.string().min(1),
		followUp1Subject: z.string().min(1),
		followUp1Body: z.string().min(1),
		followUp2Subject: z.string().min(1),
		followUp2Body: z.string().min(1),
	}),
]);

export type PostCacheUpdatePayload = z.infer<
	typeof postCacheUpdatePayloadSchema
>;

/** Body for the internal `post-cache/batch-get` endpoint. */
export const postCacheBatchGetPayloadSchema = z.object({
	originalPostUrls: z.array(z.string().min(1)).min(1),
});

export type PostCacheBatchGetPayload = z.infer<
	typeof postCacheBatchGetPayloadSchema
>;

/**
 * A cached post row returned by `post-cache/batch-get`. All copy fields are
 * nullable; which set is populated depends on `source`. Consumers narrow on
 * `source` + non-null fields before use.
 */
export const postCacheRowSchema = z.object({
	originalPostUrl: z.string(),
	source: postSourceSchema.nullable(),
	scraped: z.boolean(),
	postContent: z.string().nullable(),
	posterName: z.string().nullable(),
	posterLeadMagnet: z.string().nullable(),
	targetedLeadMagnetId: z.string().nullable(),
	followUpOneLeadMagnetId: z.string().nullable(),
	followUpTwoLeadMagnetId: z.string().nullable(),
	email1Subject: z.string().nullable(),
	email1Body: z.string().nullable(),
	followUp1Subject: z.string().nullable(),
	followUp1Body: z.string().nullable(),
	followUp2Subject: z.string().nullable(),
	followUp2Body: z.string().nullable(),
	dm1Body: z.string().nullable(),
	dm2Body: z.string().nullable(),
	dm3Body: z.string().nullable(),
});

export type PostCacheRow = z.infer<typeof postCacheRowSchema>;
