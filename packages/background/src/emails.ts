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

/**
 * Long dashes the model likes to emit: figure dash, en dash, em dash,
 * horizontal bar, and the minus sign. All collapse to a single hyphen.
 */
const LONG_DASH_RE = /[\u2012\u2013\u2014\u2015\u2212]/g;
/** Runs of 2+ hyphens (e.g. an ASCII "--" em dash) collapse to one. */
const REPEATED_HYPHEN_RE = /-{2,}/g;

/**
 * Force email copy to use a single hyphen only: rewrite every em/en/long dash
 * to `-` and collapse repeated hyphens. Runs as the final pressure guard before
 * copy reaches the Sheet, so no stored template (old or new) can ship an em
 * dash. Pure.
 */
export function stripEmDashes(text: string): string {
	return text.replace(LONG_DASH_RE, "-").replace(REPEATED_HYPHEN_RE, "-");
}

function fill(text: string, vars: LeadVariables): string {
	return text.replaceAll(FIRST_NAME_PLACEHOLDER, vars.firstName);
}

function fillEmail(email: Email, vars: LeadVariables): Email {
	return {
		subject: stripEmDashes(fill(email.subject, vars)),
		body: stripEmDashes(fill(email.body, vars)),
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
