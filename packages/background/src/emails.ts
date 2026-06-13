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

/**
 * Per-lead merge tag in stored LinkedIn DM bodies. Authored copy keeps it
 * verbatim; at generate time `applyDmLeadVariables` substitutes each lead's
 * first name (parallel to the email flow's `${firstName}`). Double-curly avoids
 * biome's `noTemplateCurlyInString`.
 */
export const DM_FIRST_NAME_TAG = "{{firstname}}";

/**
 * A post-level 3-message LinkedIn DM sequence (bodies only; DMs have no
 * subject). Authored once per post by the model and stored on the
 * `auto_emailing` row. `{{firstname}}` is the only token left in the copy; the
 * hard-to-fill role and post context are baked in at authoring time.
 */
export interface DmSequence {
	dm1: string;
	dm2: string;
	dm3: string;
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

/**
 * Substitute the per-lead first name into a stored DM sequence, producing the
 * three bodies to write to the Sheet for one lead. Replaces every
 * `{{firstname}}` merge tag with `vars.firstName`; the same `template` yields
 * the same copy for every commenter on a post apart from the name. Pure: no I/O.
 */
export function applyDmLeadVariables(
	template: DmSequence,
	vars: LeadVariables
): DmSequence {
	const fillDm = (body: string): string =>
		stripEmDashes(body.replaceAll(DM_FIRST_NAME_TAG, vars.firstName));
	return {
		dm1: fillDm(template.dm1),
		dm2: fillDm(template.dm2),
		dm3: fillDm(template.dm3),
	};
}
