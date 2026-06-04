/**
 * Read a required environment variable, throwing a descriptive error when it is
 * unset or empty. Trigger tasks run on Node (not the Worker), so task-side
 * secrets are read from `process.env`, not the typed Worker env package.
 *
 * @param name - The environment variable name.
 * @returns The non-empty value.
 * @throws If the variable is missing or empty.
 */
export function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}
