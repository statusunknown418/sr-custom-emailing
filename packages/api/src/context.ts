import type { Context as HonoContext } from "hono";

export interface CreateContextOptions {
	context: HonoContext;
}

export function createContext(options: CreateContextOptions) {
	return {
		auth: null,
		session: null,
		headers: options.context.req.raw.headers,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
