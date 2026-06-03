/** Key for the per-lead first-name variable. */
const FIRST_NAME_KEY = "firstName";

/**
 * The only per-lead placeholder allowed in a stored email template. Built from
 * parts so the source never contains a literal `${...}` token (forbidden by
 * biome's `noTemplateCurlyInString`). Resolves to the string `${firstName}`.
 */
export const FIRST_NAME_PLACEHOLDER = `\${${FIRST_NAME_KEY}}`;

/** A single email (subject + body). */
export interface Email {
	body: string;
	subject: string;
}

/**
 * A post-level 3-email sequence. Authored once per post by the model (see
 * `generatePostEmailSequence`) and stored on the `auto_emailing` row. The poster
 * name and post context are baked in at authoring time; `${firstName}` is the
 * only token left for per-lead substitution.
 */
export interface EmailSequence {
	email1: Email;
	followUp1: Email;
	followUp2: Email;
}

/** Per-lead variables substituted into a stored template. */
export interface LeadVariables {
	firstName: string;
}

function fill(text: string, vars: LeadVariables): string {
	return text.replaceAll(FIRST_NAME_PLACEHOLDER, vars.firstName);
}

function fillEmail(email: Email, vars: LeadVariables): Email {
	return {
		subject: fill(email.subject, vars),
		body: fill(email.body, vars),
	};
}

/**
 * Apply per-lead variables to a stored post-level template, producing the
 * sequence to write to the Sheet for one lead. The same `template` yields the
 * same copy for every commenter on a post; only `${firstName}` differs. Pure:
 * no I/O.
 */
export function applyLeadVariables(
	template: EmailSequence,
	vars: LeadVariables
): EmailSequence {
	return {
		email1: fillEmail(template.email1, vars),
		followUp1: fillEmail(template.followUp1, vars),
		followUp2: fillEmail(template.followUp2, vars),
	};
}
