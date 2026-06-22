/**
 * Constant-time string comparison so shared webhook secrets can't be probed via
 * response-timing differences. Returns false immediately on a length mismatch.
 */
export function safeEqual(a: string, b: string): boolean {
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
