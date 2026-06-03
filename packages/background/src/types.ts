import { z } from "zod";

export const startBackgroundProcessingPayloadSchema = z.object({
	requestId: z.string().min(1),
	source: z.string().min(1).default("api"),
	metadata: z.record(z.string(), z.string()).optional(),
});

export type StartBackgroundProcessingPayload = z.input<
	typeof startBackgroundProcessingPayloadSchema
>;

/** Public API input: kick off scraping for one LinkedIn post. */
export const startLinkedinScrapingPayloadSchema = z.object({
	originalPostUrl: z.string().min(1),
});

export type StartLinkedinScrapingPayload = z.infer<
	typeof startLinkedinScrapingPayloadSchema
>;

/** Payload for the `scrape-post` Trigger task. */
export const scrapePostPayloadSchema = z.object({
	originalPostUrl: z.string().min(1),
});

export type ScrapePostPayload = z.infer<typeof scrapePostPayloadSchema>;

/** A single lead row delivered by Clay. All fields are required. */
export const clayLeadSchema = z.object({
	staffinClassification: z.string(),
	companyName: z.string(),
	companyUrl: z.string(),
	companyLinkedin: z.string(),
	companyEmployees: z.string(),
	companyIndustry: z.string(),
	companyDescription: z.string(),
	name: z.string(),
	country: z.string(),
	originalComment: z.string(),
	originalPostUrl: z.string().min(1),
	personalLinkedinUrl: z.string(),
});

export type ClayLead = z.infer<typeof clayLeadSchema>;

/** Public API input / `email-generation` task payload: at least one lead. */
export const emailGenerationPayloadSchema = z.object({
	leads: z.array(clayLeadSchema).min(1),
});

export type EmailGenerationPayload = z.infer<
	typeof emailGenerationPayloadSchema
>;

/**
 * Body for the internal `post-cache/update` endpoint. The `scrape-post` task
 * sends this to the Worker after scraping, selecting the magnets, and authoring
 * the post-level email template; the Worker writes it to D1. Shared here so the
 * task and the endpoint agree on the contract without the API package depending
 * on background (which would cycle). Template bodies use `${firstName}` as the
 * only per-lead placeholder.
 */
export const postCacheUpdatePayloadSchema = z.object({
	originalPostUrl: z.string().min(1),
	postContent: z.string().min(1),
	posterName: z.string().nullish(),
	targetedLeadMagnetId: z.string().min(1),
	followUpOneLeadMagnetId: z.string().min(1),
	followUpTwoLeadMagnetId: z.string().min(1),
	email1Subject: z.string().min(1),
	email1Body: z.string().min(1),
	followUp1Subject: z.string().min(1),
	followUp1Body: z.string().min(1),
	followUp2Subject: z.string().min(1),
	followUp2Body: z.string().min(1),
});

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

/** A cached post row returned by `post-cache/batch-get`. */
export const postCacheRowSchema = z.object({
	originalPostUrl: z.string(),
	scraped: z.boolean(),
	postContent: z.string().nullable(),
	posterName: z.string().nullable(),
	targetedLeadMagnetId: z.string().nullable(),
	followUpOneLeadMagnetId: z.string().nullable(),
	followUpTwoLeadMagnetId: z.string().nullable(),
	email1Subject: z.string().nullable(),
	email1Body: z.string().nullable(),
	followUp1Subject: z.string().nullable(),
	followUp1Body: z.string().nullable(),
	followUp2Subject: z.string().nullable(),
	followUp2Body: z.string().nullable(),
});

export type PostCacheRow = z.infer<typeof postCacheRowSchema>;
