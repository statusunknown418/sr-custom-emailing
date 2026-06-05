import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { z } from "zod";
import {
	type EmailSequence,
	FIRST_NAME_PLACEHOLDER,
	stripEmDashes,
} from "./emails";
import { LEAD_MAGNETS, resolveLeadMagnetSequence } from "./lead-magnets";
import { DEFAULT_FIRST_NAME, getFirstName } from "./names";

/**
 * Anthropic model used to select magnets and author the email sequence. The
 * provider reads `ANTHROPIC_API_KEY` from the environment automatically.
 */
const SELECTION_MODEL = "claude-sonnet-4-5";

/** One catalog line per magnet, given to the model to choose from. */
const LEAD_MAGNET_CATALOG = LEAD_MAGNETS.map(
	(magnet) =>
		`- ${magnet.id} [${magnet.category}] ${magnet.leadMagnet}: ${magnet.description} (pain: so you don't ${magnet.painLine})`
).join("\n");

const SYSTEM_PROMPT = `You write cold outreach for a recruiting tools company, targeting people who commented on a LinkedIn lead-magnet post.

Do two things from the post content:
1. Select exactly THREE DISTINCT lead magnets from the catalog (return their ids verbatim). Only ids in the catalog exist - never invent one.
   - targetedLeadMagnetId: best fit for the post topic (used in email 1).
   - followUpOneLeadMagnetId, followUpTwoLeadMagnetId: complementary, used in the two follow-ups.
2. Write a 3-email sequence tailored to THIS post. Personalize with the post's topic and the poster's FIRST name only when one is provided (e.g. "Alex", never "Alex Papageorge").

Rules for the copy:
- The ONLY placeholder allowed is ${FIRST_NAME_PLACEHOLDER}. Bake everything else (poster first name, topic, magnet pitch) directly into the text - do not leave any other \${...} tokens.
- Every email body must open with "Hey ${FIRST_NAME_PLACEHOLDER}," so each body contains ${FIRST_NAME_PLACEHOLDER}.
- Keep it short, plain text, lowercase casual subjects, no markdown, no signature.
- NEVER use em dashes or en dashes (— or –). Use a single hyphen "-" or rephrase. Only a single dash is allowed anywhere in the copy.

Structure to follow:
- email1: reference their comment ("Saw your comment on <poster first name>'s post about <topic>." - drop the name if no poster is given), pitch the targeted magnet, soft CTA ("Want to check it out?"). Subject like "saw your linkedin comment" or "<poster first name>'s <topic>".
- followUp1: subject "one more thing"; "We also built this one - <second magnet pitch>."; CTA "Want both?".
- followUp2: subject "last thing"; "Last one - <third magnet pitch>."; CTA "Should I send it over?".

Catalog:
${LEAD_MAGNET_CATALOG}`;

const generationSchema = z.object({
	targetedLeadMagnetId: z
		.string()
		.describe("Catalog id of the primary magnet (email 1)."),
	followUpOneLeadMagnetId: z
		.string()
		.describe(
			"Catalog id of the magnet for follow-up 1. Distinct from the others."
		),
	followUpTwoLeadMagnetId: z
		.string()
		.describe(
			"Catalog id of the magnet for follow-up 2. Distinct from the others."
		),
	email1Subject: z.string().describe("Email 1 subject line."),
	email1Body: z
		.string()
		.describe(`Email 1 body. Must contain ${FIRST_NAME_PLACEHOLDER}.`),
	followUp1Subject: z.string().describe("Follow-up 1 subject line."),
	followUp1Body: z
		.string()
		.describe(`Follow-up 1 body. Must contain ${FIRST_NAME_PLACEHOLDER}.`),
	followUp2Subject: z.string().describe("Follow-up 2 subject line."),
	followUp2Body: z
		.string()
		.describe(`Follow-up 2 body. Must contain ${FIRST_NAME_PLACEHOLDER}.`),
	reason: z.string().describe("One sentence explaining the magnet choices."),
});

/** Selected magnets plus the authored, post-level email template. */
export interface GeneratedPostSequence {
	followUpOneLeadMagnetId: string;
	followUpTwoLeadMagnetId: string;
	reason: string;
	targetedLeadMagnetId: string;
	template: EmailSequence;
}

function requireNonEmpty(value: string, field: string): string {
	const trimmed = value.trim();
	if (trimmed === "") {
		throw new Error(`Model returned an empty ${field}`);
	}
	// Normalize away em/en dashes so no stored template field can ship one.
	return stripEmDashes(trimmed);
}

function requirePersonalizedBody(value: string, field: string): string {
	const body = requireNonEmpty(value, field);
	if (!body.includes(FIRST_NAME_PLACEHOLDER)) {
		throw new Error(
			`${field} is missing the ${FIRST_NAME_PLACEHOLDER} placeholder`
		);
	}
	return body;
}

/**
 * From scraped post content, select the post-level lead magnet sequence (3
 * distinct real magnets from the library) and author the 3-email template. The
 * model only chooses catalog ids; after it responds the ids are validated to
 * exist and be distinct via {@link resolveLeadMagnetSequence}, and each email
 * body is checked to be non-empty and to contain `${firstName}`.
 *
 * @throws If `postContent` is blank, the model returns unknown/duplicate ids, or
 *   any template field is empty / a body lacks the `${firstName}` placeholder.
 */
export async function generatePostEmailSequence(input: {
	postContent: string;
	posterName?: string | null;
}): Promise<GeneratedPostSequence> {
	const postContent = requireNonEmpty(input.postContent, "post content");
	// Only the poster's first name is baked into the copy ("Alex", not "Alex
	// Papageorge"); drop the poster entirely when no real name resolves.
	const rawPosterName = input.posterName?.trim();
	const derivedFirstName = rawPosterName
		? getFirstName(rawPosterName)
		: DEFAULT_FIRST_NAME;
	const posterFirstName =
		derivedFirstName === DEFAULT_FIRST_NAME ? undefined : derivedFirstName;

	const { output } = await generateText({
		model: anthropic(SELECTION_MODEL),
		output: Output.object({ schema: generationSchema }),
		system: SYSTEM_PROMPT,
		prompt: posterFirstName
			? `Poster first name: ${posterFirstName}\n\nLinkedIn post content:\n\n${postContent}`
			: `LinkedIn post content:\n\n${postContent}`,
	});

	// Throws on unknown or non-distinct ids.
	const resolved = resolveLeadMagnetSequence({
		targetedLeadMagnetId: output.targetedLeadMagnetId,
		followUpOneLeadMagnetId: output.followUpOneLeadMagnetId,
		followUpTwoLeadMagnetId: output.followUpTwoLeadMagnetId,
	});

	const template: EmailSequence = {
		email1: {
			subject: requireNonEmpty(output.email1Subject, "email1Subject"),
			body: requirePersonalizedBody(output.email1Body, "email1Body"),
		},
		followUp1: {
			subject: requireNonEmpty(output.followUp1Subject, "followUp1Subject"),
			body: requirePersonalizedBody(output.followUp1Body, "followUp1Body"),
		},
		followUp2: {
			subject: requireNonEmpty(output.followUp2Subject, "followUp2Subject"),
			body: requirePersonalizedBody(output.followUp2Body, "followUp2Body"),
		},
	};

	return {
		targetedLeadMagnetId: resolved.targeted.id,
		followUpOneLeadMagnetId: resolved.followUpOne.id,
		followUpTwoLeadMagnetId: resolved.followUpTwo.id,
		template,
		reason: output.reason,
	};
}
