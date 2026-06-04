import { ORPCError } from "@orpc/server";
import { env } from "@sr-custom-emailing/env/server";

import { publicProcedure } from "./index";

const INTERNAL_SECRET_HEADER = "x-internal-secret";

/** Constant-time string comparison to avoid leaking the secret via timing. */
function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}

	let mismatch = 0;
	for (let i = 0; i < a.length; i += 1) {
		if (a.charCodeAt(i) !== b.charCodeAt(i)) {
			mismatch += 1;
		}
	}
	return mismatch === 0;
}

/**
 * Authorize a request carrying the shared internal secret. Fails closed: when
 * the secret is not configured on the Worker, every request is rejected.
 */
function isAuthorizedInternalRequest(provided: string | null): boolean {
	const expected = env.INTERNAL_API_SECRET;
	if (!expected || provided === null) {
		return false;
	}

	return safeEqual(provided, expected);
}

/**
 * Procedure guarded by the shared internal secret (`x-internal-secret` header).
 * Covers both the Trigger-task callbacks (the only path to D1 from a task) and
 * the automation trigger endpoints, which are server-to-server only (Clay and
 * the scraping caller) and must never be world-callable.
 */
export const internalProcedure = publicProcedure.use(({ context, next }) => {
	const provided = context.headers.get(INTERNAL_SECRET_HEADER);
	if (!isAuthorizedInternalRequest(provided)) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Invalid or missing internal secret",
		});
	}

	return next();
});
