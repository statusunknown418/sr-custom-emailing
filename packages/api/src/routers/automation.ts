import {
	startBackgroundProcessingPayloadSchema,
	triggerStartBackgroundProcessing,
} from "@sr-custom-emailing/background";

import { publicProcedure } from "../index";

export const automationsRouter = {
	startBackgroundProcessing: publicProcedure
		.route({
			method: "POST",
			path: "/automation/background-processing",
		})
		.input(startBackgroundProcessingPayloadSchema)
		.handler(async ({ input }) => {
			const handle = await triggerStartBackgroundProcessing(input);

			return { runId: handle.id };
		}),
};
