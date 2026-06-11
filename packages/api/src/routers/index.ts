import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { internalRouter } from "./internal";
import { ourLinkedinCommentTrackingRouter } from "./our-linkedin-comment-tracking";
import { someoneElsePostScrapingRouter } from "./someone-else-post-scraping";

export const appRouter = {
	healthCheck: publicProcedure
		.route({
			method: "GET",
		})
		.handler(() => "OK"),
	ourLinkedinCommentTracking: ourLinkedinCommentTrackingRouter,
	someoneElsePostScraping: someoneElsePostScrapingRouter,
	internal: internalRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
