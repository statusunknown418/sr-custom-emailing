import { metadata, schemaTask } from "@trigger.dev/sdk";

import { startBackgroundProcessingPayloadSchema } from "../types";

export const startBackgroundProcessing = schemaTask({
	id: "start-background-processing",
	schema: startBackgroundProcessingPayloadSchema,
	retry: {
		maxAttempts: 3,
		factor: 1.8,
		minTimeoutInMs: 500,
		maxTimeoutInMs: 30_000,
	},
	run: (payload) => {
		metadata.set("requestId", payload.requestId).set("source", payload.source);

		return Promise.resolve({
			requestId: payload.requestId,
			source: payload.source,
			completedAt: new Date().toISOString(),
		});
	},
});
