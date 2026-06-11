import {
	runScrape,
	type ScrapeFlow,
} from "@sr-custom-emailing/api/scrape-service";
import { env } from "@sr-custom-emailing/env/server";
import type { Context } from "hono";

const SIGNATURE_HEADER = "x-signature-ed25519";
const TIMESTAMP_HEADER = "x-signature-timestamp";
/** Discord interaction type for the verification PING (its response is also 1). */
const INTERACTION_PING = 1;
/** Discord response type CHANNEL_MESSAGE_WITH_SOURCE. */
const RESPONSE_CHANNEL_MESSAGE = 4;
/** Option name carrying the post URL on the two flow commands. */
const URL_OPTION_NAME = "text_input";
const HEX_PAIR_RE = /.{1,2}/g;

interface DiscordCommandOption {
	name: string;
	value: string;
}

interface DiscordInteraction {
	data?: {
		name?: string;
		options?: DiscordCommandOption[];
	};
	type: number;
}

function hexToBytes(hex: string): Uint8Array {
	return Uint8Array.from(hex.match(HEX_PAIR_RE) ?? [], (pair) =>
		Number.parseInt(pair, 16)
	);
}

/**
 * Verify a Discord interaction's Ed25519 signature over `timestamp + rawBody`
 * using the app's public key. Fails closed: a missing header/key or any crypto
 * error returns `false`.
 */
async function isValidSignature(
	rawBody: string,
	signature: string | undefined,
	timestamp: string | undefined,
	publicKeyHex: string
): Promise<boolean> {
	if (!(signature && timestamp && publicKeyHex)) {
		return false;
	}

	try {
		const key = await crypto.subtle.importKey(
			"raw",
			hexToBytes(publicKeyHex),
			{ name: "Ed25519" },
			false,
			["verify"]
		);
		const message = new TextEncoder().encode(timestamp + rawBody);
		return await crypto.subtle.verify(
			"Ed25519",
			key,
			hexToBytes(signature),
			message
		);
	} catch {
		return false;
	}
}

/** Build the immediate Discord reply for a flow scrape command. */
async function scrapeReply(flow: ScrapeFlow, interaction: DiscordInteraction) {
	const url = interaction.data?.options?.find(
		(option) => option.name === URL_OPTION_NAME
	)?.value;

	if (!url) {
		return {
			type: RESPONSE_CHANNEL_MESSAGE,
			data: { content: "Missing LinkedIn post URL." },
		};
	}

	const result = await runScrape(flow, url);
	const label = flow === "comment_tracking" ? "our post" : "post";
	const base =
		result.status === "cached"
			? `Already scraped this ${label}: ${result.originalPostUrl}`
			: `Scraping ${label} (run ${result.runId}): ${result.originalPostUrl}`;
	const content = `${base}\nHarvesting commenters (run ${result.commentersRunId}).`;

	return { type: RESPONSE_CHANNEL_MESSAGE, data: { content } };
}

/**
 * Single Discord interactions endpoint. Verifies the signature, answers the
 * PING, then routes by command name: `linkedin` forwards the interaction to the
 * Make webhook; `our-posts` and `someone-else` start the respective
 * scrape flows (lead generation happens later from Clay leads).
 */
export async function handleDiscordInteraction(c: Context): Promise<Response> {
	const signature = c.req.header(SIGNATURE_HEADER);
	const timestamp = c.req.header(TIMESTAMP_HEADER);
	const rawBody = await c.req.text();

	const valid = await isValidSignature(
		rawBody,
		signature,
		timestamp,
		env.DISCORD_PUBLIC_KEY
	);
	if (!valid) {
		return c.text("invalid request signature", 401);
	}

	const interaction = JSON.parse(rawBody) as DiscordInteraction;

	if (interaction.type === INTERACTION_PING) {
		return c.json({ type: INTERACTION_PING });
	}

	const commandName = interaction.data?.name;

	if (commandName === "linkedin") {
		// ACK Discord inside its ~3s window, then forward the interaction to the
		// Make webhook in the background. The signature is already verified above,
		// so there's no intermediate verifier worker; Make delivers the result via
		// the interaction follow-up. Blocking on this round-trip is what tripped
		// Discord's "didn't respond in time".
		c.executionCtx.waitUntil(
			fetch(env.MAKE_WEBHOOK_URL, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: rawBody,
			}).then(
				(response) => console.log("make forward status:", response.status),
				(error) => console.error("make forward failed:", error)
			)
		);

		return c.json({
			type: RESPONSE_CHANNEL_MESSAGE,
			data: { content: "Processing..." },
		});
	}

	if (commandName === "our-posts") {
		return c.json(await scrapeReply("comment_tracking", interaction));
	}

	if (commandName === "someone-else") {
		return c.json(await scrapeReply("someone_else", interaction));
	}

	return c.json({
		type: RESPONSE_CHANNEL_MESSAGE,
		data: { content: `Unknown command: ${commandName ?? "unknown"}` },
	});
}
