import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createContext } from "@sr-custom-emailing/api/context";
import { appRouter } from "@sr-custom-emailing/api/routers/index";
import { env } from "@sr-custom-emailing/env/server";
import { type EvlogVariables, evlog } from "evlog/hono";
import { initWorkersLogger } from "evlog/workers";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { handleApifyCommentersWebhook } from "./apify-webhook";
import { handleDiscordInteraction } from "./discord";
import { handleInstantlyReplyWebhook } from "./instantly-reply-webhook";

initWorkersLogger({
	env: { service: "sr-custom-emailing-server" },
});

const app = new Hono<EvlogVariables>();

app.use(evlog());

app.use(
	"/*",
	cors({
		origin: env.CORS_ORIGIN,
		allowMethods: ["GET", "POST", "OPTIONS"],
	})
);

export const apiHandler = new OpenAPIHandler(appRouter, {
	plugins: [
		new OpenAPIReferencePlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}),
	],
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

export const rpcHandler = new RPCHandler(appRouter, {
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

app.use("/*", async (c, next) => {
	const context = createContext({ context: c });

	const rpcResult = await rpcHandler.handle(c.req.raw, {
		prefix: "/rpc",
		context,
	});

	if (rpcResult.matched) {
		return c.newResponse(rpcResult.response.body, rpcResult.response);
	}

	const apiResult = await apiHandler.handle(c.req.raw, {
		prefix: "/api-reference",
		context,
	});

	if (apiResult.matched) {
		return c.newResponse(apiResult.response.body, apiResult.response);
	}

	await next();
});

app.post("/discord/interactions", (c) => handleDiscordInteraction(c));
app.post("/apify/commenters/:flow", (c) => handleApifyCommentersWebhook(c));
app.post("/instantly/replies", (c) =>
	handleInstantlyReplyWebhook(c, "primary")
);
app.post("/instantly/replies/extra", (c) =>
	handleInstantlyReplyWebhook(c, "extra")
);

app.get("/", (c) => c.text("See /rpc and the appropiate route!"));

export default app;
