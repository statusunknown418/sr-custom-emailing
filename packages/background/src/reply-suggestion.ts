import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { z } from "zod";
import { stripEmDashes } from "./emails";
import { LEAD_MAGNETS } from "./lead-magnets";

/**
 * Anthropic model used to classify the reply and draft Alex's response. The
 * provider reads `ANTHROPIC_API_KEY` from the environment automatically.
 */
const SUGGESTION_MODEL = "claude-sonnet-4-5";

/**
 * How interested the prospect's reply is. Drives the Slack header (`:fire: Hot
 * reply` for `interested`, a calmer label otherwise) and lets the draft match
 * the moment - a warm push when they bite, a graceful close when they pass.
 */
export const REPLY_INTENTS = ["interested", "maybe", "not_interested"] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

/**
 * The SuperRecruiter lead magnets the draft may offer, one line each. Same
 * catalog the cold-outreach authoring uses (`lead-magnet-selection.ts`); given
 * to the model so a suggested reply can point an interested prospect at the
 * right resource instead of inventing one.
 */
const LEAD_MAGNET_CATALOG = LEAD_MAGNETS.map(
	(magnet) => `- ${magnet.leadMagnet}: ${magnet.description}`
).join("\n");

/**
 * Alex Papageorge's email voice, distilled into a drafting brief. Encodes the
 * "Alex Email Writer" skill: reader-as-hero, plain words, short blocks, present
 * tense, one clear ask, and the hard bans (em dashes, "circle back", opening on
 * "I"). The model returns one ready-to-send reply plus an intent read.
 */
const SYSTEM_PROMPT = `You draft email replies in Alex Papageorge's voice. Alex is the CEO of Super Recruiter, a recruiting-tools company. A prospect just replied to one of Alex's cold emails. Read their reply (and our prior message for context) and write the single reply Alex would send back.

Voice - non-negotiable:
- The reader is the hero. Frame around "you", not "I/we". Use "I/we" only for a quick proof point, then pivot back to "you".
- The 18-year-old test: short, plain, everyday words. One idea per sentence. No jargon left unexplained.
- Concise, no fluff. Short sentences. Paragraph blocks of 1-2 sentences. Present tense ("this saves you", never "will save you"). White space does the work.
- Human, not corporate. Sounds like a sharp person texting a colleague. Confident, never salesy, never begging.

Hard bans - never appear:
- Em dashes or en dashes. Use a single spaced hyphen ( - ) or rephrase.
- Passive voice when active works.
- Opening the email with the word "I". Lead with the reader or the point.
- "Circle back" / "circling back" in any form.
- "I hope this finds you well", "just wanted to reach out", "I'd love to connect", "leverage", "synergy", "add value".

Match the voice to the reply:
- Interested / asking for more: stay warm and direct, give them the thing, end with one clear next step. When a SuperRecruiter resource fits what they asked, offer it by name from the catalog below - never invent one.
- Neutral / a question: answer it plainly, keep one light ask open.
- Not interested / declining: stay short but human. Acknowledge them, keep the door open, no groveling. Do not pitch.

Format of the reply you write:
- Start "Hi <FirstName>," using the prospect's first name when the thread shows it; otherwise open with the point.
- Plain text only. No markdown, no subject line.
- Exactly one clear ask, impossible to misread.
- Sign off light, on its own lines:
  Talk soon,
  Alex Papageorge
  CEO @ Super Recruiter

Also classify the reply's intent: "interested", "maybe", or "not_interested".

SuperRecruiter lead magnets you may offer (name them exactly; never invent):
${LEAD_MAGNET_CATALOG}`;

const suggestionSchema = z.object({
	intent: z
		.enum(REPLY_INTENTS)
		.describe(
			"How interested the prospect is: interested (wants more / asks to proceed), maybe (neutral or a question), not_interested (declining / unsubscribe / not a fit)."
		),
	suggestedResponse: z
		.string()
		.describe(
			"The complete, ready-to-send reply in Alex's voice, including greeting and sign-off. Plain text, no markdown, no em dashes."
		),
});

/** A drafted reply plus the model's read of how interested the prospect is. */
export interface ReplySuggestion {
	intent: ReplyIntent;
	suggestedResponse: string;
}

/**
 * Classify a prospect's reply and draft Alex's response to it, using his email
 * voice and the SuperRecruiter lead-magnet catalog. The prior message we sent
 * is passed for context when available (Instantly's reply webhook omits it).
 *
 * @throws If the model call fails. Callers post the notification without a
 *   suggestion rather than dropping it, so this is best-effort upstream.
 */
export async function generateReplySuggestion(input: {
	campaignName: string;
	priorMessage?: string | null;
	replyText: string;
}): Promise<ReplySuggestion> {
	const prompt = [
		`Campaign: ${input.campaignName || "Unknown"}`,
		input.priorMessage
			? `Our prior message to them:\n${input.priorMessage}`
			: "Our prior message to them: (not available)",
		`Their reply:\n${input.replyText}`,
	].join("\n\n");

	const { output } = await generateText({
		model: anthropic(SUGGESTION_MODEL),
		output: Output.object({ schema: suggestionSchema }),
		prompt,
		system: SYSTEM_PROMPT,
	});

	return {
		intent: output.intent,
		suggestedResponse: stripEmDashes(output.suggestedResponse.trim()),
	};
}
