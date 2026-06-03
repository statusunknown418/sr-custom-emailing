const TRAILING_SLASH_RE = /\/+$/;
const WWW_PREFIX_RE = /^www\./;

/**
 * Normalize a LinkedIn post URL into a stable cache key.
 *
 * The same post must always map to the same string so the D1 `auto_emailing`
 * row is shared by every commenter. Normalization lower-cases the scheme and
 * host, drops a leading `www.`, strips query strings, fragments, and trailing
 * slashes. The path is preserved verbatim because LinkedIn activity slugs are
 * case-sensitive identifiers. Pure: no I/O.
 *
 * @param url - Raw URL as supplied by Clay / the API caller.
 * @returns The canonical form, or a trimmed/lower-cased fallback when `url` is
 *   not a parseable absolute URL.
 */
export function normalizePostUrl(url: string): string {
	const trimmed = url.trim();

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return trimmed.replace(TRAILING_SLASH_RE, "").toLowerCase();
	}

	parsed.hash = "";
	parsed.search = "";

	const protocol = parsed.protocol.toLowerCase();
	const host = parsed.host.toLowerCase().replace(WWW_PREFIX_RE, "");
	const path = parsed.pathname.replace(TRAILING_SLASH_RE, "");

	return `${protocol}//${host}${path}`;
}
