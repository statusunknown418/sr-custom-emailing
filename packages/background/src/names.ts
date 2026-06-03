const WHITESPACE_RE = /\s+/;
const LEADING_NON_WORD_RE = /^[^\p{L}]+/u;

/** Greeting fallback used when a usable first name cannot be derived. */
export const DEFAULT_FIRST_NAME = "there";

/**
 * Derive a usable first name from a Clay lead's full name.
 *
 * Strips leading non-letter characters (stray punctuation, leading emoji) from
 * the whole name, then takes the first whitespace-delimited token. Falls back to
 * {@link DEFAULT_FIRST_NAME} when the input is blank or has no letters, so email
 * greetings never render as "Hey ,". Pure: no I/O.
 *
 * @param fullName - The lead's full name (e.g. `"John Doe"`).
 * @returns The first name, or {@link DEFAULT_FIRST_NAME}.
 */
export function getFirstName(fullName: string): string {
	const cleaned = fullName.trim().replace(LEADING_NON_WORD_RE, "");
	if (cleaned === "") {
		return DEFAULT_FIRST_NAME;
	}

	const [firstToken] = cleaned.split(WHITESPACE_RE);
	return firstToken && firstToken !== "" ? firstToken : DEFAULT_FIRST_NAME;
}
