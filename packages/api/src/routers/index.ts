import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { automationsRouter } from "./automation";
import { internalRouter } from "./internal";

export const appRouter = {
	healthCheck: publicProcedure
		.route({
			method: "GET",
		})
		.handler(() => "OK"),
	automations: automationsRouter,
	internal: internalRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
