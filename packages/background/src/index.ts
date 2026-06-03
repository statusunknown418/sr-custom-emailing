import { tasks } from "@trigger.dev/sdk";
import type { startBackgroundProcessing } from "./trigger/start-background-processing";
import {
	type StartBackgroundProcessingPayload,
	startBackgroundProcessingPayloadSchema,
} from "./types";

export type { StartBackgroundProcessingPayload } from "./types";
export { startBackgroundProcessingPayloadSchema } from "./types";

export interface TriggerStartBackgroundProcessingResult {
	id: string;
}

export async function triggerStartBackgroundProcessing(
	payload: StartBackgroundProcessingPayload
): Promise<TriggerStartBackgroundProcessingResult> {
	const parsedPayload = startBackgroundProcessingPayloadSchema.parse(payload);
	const handle = await tasks.trigger<typeof startBackgroundProcessing>(
		"start-background-processing",
		parsedPayload
	);

	return { id: handle.id };
}
