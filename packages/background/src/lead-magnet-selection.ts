import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { z } from "zod";
import {
	DM_FIRST_NAME_TAG,
	type DmSequence,
	type EmailSequence,
	FIRST_NAME_PLACEHOLDER,
	stripEmDashes,
} from "./emails";
import {
	getLeadMagnetInstantlyFields,
	LEAD_MAGNETS,
	type LeadMagnet,
	resolveLeadMagnetSequence,
} from "./lead-magnets";
import { DEFAULT_FIRST_NAME, getFirstName } from "./names";

/**
 * Anthropic model used to select magnets and author the copy. The provider
 * reads `ANTHROPIC_API_KEY` from the environment automatically.
 */
const SELECTION_MODEL = "claude-sonnet-4-5";

/** One catalog line per magnet, given to the model to choose from. */
const LEAD_MAGNET_CATALOG = LEAD_MAGNETS.map(
	(magnet) =>
		`- ${magnet.id} [${magnet.category}] ${magnet.leadMagnet}: ${magnet.description} (pain: so you don't ${magnet.painLine})`
).join("\n");

const EMAIL_SYSTEM_PROMPT = `You write cold outreach for a recruiting tools company, targeting people who commented on a LinkedIn lead-magnet post.

Do three things from the post content:
1. Identify the lead magnet / resource / offer the POSTER used in the LinkedIn post.
   - posterLeadMagnet: exact title when stated; otherwise a concise description of the resource/offer; use "none found" only when the post does not promote any resource.
2. Select exactly THREE DISTINCT SuperRecruiter lead magnets WE could use from the catalog (return their ids verbatim). Only ids in the catalog exist - never invent one.
   - targetedLeadMagnetId: best SuperRecruiter fit for the post topic (used in email 1).
   - followUpOneLeadMagnetId, followUpTwoLeadMagnetId: complementary SuperRecruiter magnets, used in the two follow-ups.
3. Write a 3-email sequence tailored to THIS post. Personalize with the post's topic and the poster's FULL name when one is provided (e.g. "Alex Papageorge", never only "Alex").

Rules for the copy:
- The ONLY placeholder allowed is ${FIRST_NAME_PLACEHOLDER}. Bake everything else (poster full name, topic, magnet pitch) directly into the text - do not leave any other \${...} tokens.
- Every email body must open with "Hey ${FIRST_NAME_PLACEHOLDER}," so each body contains ${FIRST_NAME_PLACEHOLDER}.
- Keep it short, plain text, lowercase casual subjects, no markdown, no signature.
- Lead magnet wording in the copy must be lowercase. Never capitalize any letter in any lead magnet word.
- NEVER use em dashes or en dashes (— or –). Use a single hyphen "-" or rephrase. Only a single dash is allowed anywhere in the copy.

Structure to follow:
- email1: reference their comment ("Saw your comment on <poster full name>'s post about <post label>."). Keep <post label> to 3 words or fewer. Then pitch the targeted SuperRecruiter magnet using this exact sentence shape: "We put together something similar - <a/an> <what> that <benefit> so you don't have to <pain>." CTA: "Want to check it out?". Subject: "your LinkedIn comment".
- followUp1: subject "one more thing"; "We also built this one - <a/an> <second what> that <benefit> so you don't have to <pain>."; CTA "Want both?".
- followUp2: subject "last thing"; "Last one - <a/an> <third what> that <benefit> so you don't have to <pain>."; CTA "Should I send it over?".

Catalog:
${LEAD_MAGNET_CATALOG}`;

const DM_SYSTEM_PROMPT = `You write LinkedIn DM follow-ups for a recruiting tools company, targeting people who commented on a LinkedIn lead-magnet post.

Do two things from the post content:
1. Identify the lead magnet / resource / offer the POSTER promoted in the LinkedIn post.
   - posterLeadMagnet: exact title when stated; otherwise a concise description; use "none found" only when the post does not promote any resource.
2. Select exactly THREE DISTINCT SuperRecruiter lead magnets from the catalog (return their ids verbatim). Only ids in the catalog exist - never invent one.
   - targetedLeadMagnetId: best SuperRecruiter fit, pitched in DM 2.
   - followUpOneLeadMagnetId, followUpTwoLeadMagnetId: complementary magnets, distinct from the others.

Then write DM 1 only. The application renders DM 2 from the selected lead magnet using the approved structure. These are short, casual chat messages - NOT emails. No subject lines, no signatures, plain text, 1 to 3 short lines each.

Rules for the copy:
- The ONLY merge tag allowed is ${DM_FIRST_NAME_TAG} - a downstream tool fills it per recipient, so leave it verbatim. DM 1 must open with "Hey ${DM_FIRST_NAME_TAG}" so the body contains ${DM_FIRST_NAME_TAG}. Do NOT use \${...} or invent any other {{...}} tag.
- Make the reader the hero. Use "you" and "your" instead of "I", "me", or "my". Keep the message about their workflow, their hiring, and their result.
- NEVER use em dashes or en dashes (— or –). Use a single hyphen "-" or rephrase.

Structure to follow:
- dm1: friendly check-in on the resource they engaged with. Keep the resource mention in the first sentence to 3 words or fewer. "Hey ${DM_FIRST_NAME_TAG}, were you able to <use/apply the poster's resource>? Curious if it's helping your <workflow/hiring>."
- dm2 is rendered by the application as: "Hey ${DM_FIRST_NAME_TAG} - we put together something similar - <a/an> <what> that <benefit> so you don't have to <pain>. Worth a look?"

Catalog:
${LEAD_MAGNET_CATALOG}`;

const magnetSelectionShape = {
	posterLeadMagnet: z
		.string()
		.describe("Lead magnet / resource / offer promoted by the poster."),
	targetedLeadMagnetId: z
		.string()
		.describe("Catalog id of our primary magnet."),
	followUpOneLeadMagnetId: z
		.string()
		.describe(
			"Catalog id of the first follow-up magnet. Distinct from others."
		),
	followUpTwoLeadMagnetId: z
		.string()
		.describe(
			"Catalog id of the second follow-up magnet. Distinct from others."
		),
	reason: z.string().describe("One sentence explaining the magnet choices."),
};

const emailGenerationSchema = z.object({
	...magnetSelectionShape,
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
});

const dmGenerationSchema = z.object({
	...magnetSelectionShape,
	dm1Body: z.string().describe(`DM 1 body. Must contain ${DM_FIRST_NAME_TAG}.`),
});

/** Poster magnet plus selected SuperRecruiter magnets and authored emails. */
export interface GeneratedPostSequence {
	followUpOneLeadMagnetId: string;
	followUpTwoLeadMagnetId: string;
	posterLeadMagnet: string;
	reason: string;
	targetedLeadMagnetId: string;
	template: EmailSequence;
}

/** Poster magnet plus selected SuperRecruiter magnets and authored DMs. */
export interface GeneratedPostDmSequence {
	followUpOneLeadMagnetId: string;
	followUpTwoLeadMagnetId: string;
	posterLeadMagnet: string;
	reason: string;
	sequence: DmSequence;
	targetedLeadMagnetId: string;
}

function requireNonEmpty(value: string, field: string): string {
	const trimmed = value.trim();
	if (trimmed === "") {
		throw new Error(`Model returned an empty ${field}`);
	}
	// Normalize away em/en dashes so no stored copy field can ship one.
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

function requireDmBody(value: string, field: string): string {
	const body = requireNonEmpty(value, field);
	if (!body.includes(DM_FIRST_NAME_TAG)) {
		throw new Error(`${field} is missing the ${DM_FIRST_NAME_TAG} merge tag`);
	}
	return body;
}

const READER_OWNERSHIP_RE = /\byour\b/i;
const FIRST_PERSON_SINGULAR_RE = /\b(?:i|i'm|i’d|i'd|me|my|mine)\b/i;

function requireReaderHeroDmBody(value: string, field: string): string {
	const body = requireDmBody(value, field);
	if (!READER_OWNERSHIP_RE.test(body)) {
		throw new Error(`${field} must make the reader the hero with "your"`);
	}
	if (FIRST_PERSON_SINGULAR_RE.test(body)) {
		throw new Error(`${field} must not use first-person singular pronouns`);
	}
	return body;
}

export function renderDm2Body(magnet: LeadMagnet): string {
	const fields = getLeadMagnetInstantlyFields(magnet);
	return `Hey ${DM_FIRST_NAME_TAG} - we put together something similar - ${fields.article} ${fields.what} that ${fields.solvesthis} so you don't have to ${fields.painline}. Worth a look?`;
}

/**
 * Derive the poster's first name for personalization, or `undefined` when no
 * real name resolves (so the model drops the poster reference entirely). Only
 * the first name is ever baked in ("Alex", not "Alex Papageorge").
 */
export function derivePosterFirstName(
	posterName?: string | null
): string | undefined {
	const rawPosterName = posterName?.trim();
	if (!rawPosterName) {
		return;
	}
	const firstName = getFirstName(rawPosterName);
	return firstName === DEFAULT_FIRST_NAME ? undefined : firstName;
}

/**
 * From scraped post content, identify the poster's lead magnet, select our
 * post-level lead magnet sequence (3 distinct real magnets), and author the
 * 3-email template. The model only chooses catalog ids; after it responds the
 * ids are validated to exist and be distinct via {@link resolveLeadMagnetSequence},
 * and each email body is checked to be non-empty and to contain `${firstName}`.
 *
 * @throws If `postContent` is blank, the model returns unknown/duplicate ids, or
 *   any template field is empty / a body lacks the `${firstName}` placeholder.
 */
export async function generatePostEmailSequence(input: {
	postContent: string;
	posterName?: string | null;
}): Promise<GeneratedPostSequence> {
	const postContent = requireNonEmpty(input.postContent, "post content");
	const posterFirstName = derivePosterFirstName(input.posterName);

	const { output } = await generateText({
		model: anthropic(SELECTION_MODEL),
		output: Output.object({ schema: emailGenerationSchema }),
		system: EMAIL_SYSTEM_PROMPT,
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
		posterLeadMagnet: requireNonEmpty(
			output.posterLeadMagnet,
			"posterLeadMagnet"
		),
		targetedLeadMagnetId: resolved.targeted.id,
		followUpOneLeadMagnetId: resolved.followUpOne.id,
		followUpTwoLeadMagnetId: resolved.followUpTwo.id,
		template,
		reason: output.reason,
	};
}

/**
 * From scraped post content, identify the poster's lead magnet, select our
 * post-level lead magnet sequence (3 distinct real magnets), author DM 1, and
 * render DM 2 from the targeted magnet. Ids are validated via
 * {@link resolveLeadMagnetSequence}; both DM bodies are checked to be non-empty
 * and to contain the `{{firstname}}` merge tag (left in the stored copy;
 * substituted per lead at generate time).
 *
 * @throws If `postContent` is blank, the model returns unknown/duplicate ids, or
 *   any DM body is empty / lacks the `{{firstname}}` merge tag.
 */
export async function generatePostDmSequence(input: {
	postContent: string;
	posterName?: string | null;
}): Promise<GeneratedPostDmSequence> {
	const postContent = requireNonEmpty(input.postContent, "post content");
	const posterFirstName = derivePosterFirstName(input.posterName);

	const { output } = await generateText({
		model: anthropic(SELECTION_MODEL),
		output: Output.object({ schema: dmGenerationSchema }),
		system: DM_SYSTEM_PROMPT,
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

	const sequence: DmSequence = {
		dm1: requireReaderHeroDmBody(output.dm1Body, "dm1Body"),
		dm2: renderDm2Body(resolved.targeted),
	};

	return {
		posterLeadMagnet: requireNonEmpty(
			output.posterLeadMagnet,
			"posterLeadMagnet"
		),
		targetedLeadMagnetId: resolved.targeted.id,
		followUpOneLeadMagnetId: resolved.followUpOne.id,
		followUpTwoLeadMagnetId: resolved.followUpTwo.id,
		sequence,
		reason: output.reason,
	};
}
