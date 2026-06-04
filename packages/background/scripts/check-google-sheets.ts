/**
 * Scratch verification script for the Google Sheets service-account setup.
 * Appends one test row to the configured Sheet so you can confirm the
 * credentials, the Sheet share, the id, and the tab name are all correct
 * before wiring the Trigger.dev task. Safe to delete after verifying.
 *
 * Run:
 *   cd packages/background
 *   bun run scripts/check-google-sheets.ts
 *
 * Reads GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SHEET_ID / GOOGLE_SHEET_TAB from
 * packages/infra/.env (same file the tasks load locally) or the process env.
 */
import { fileURLToPath, URL } from "node:url";
import { config } from "dotenv";
import { google } from "googleapis";

config({
	path: fileURLToPath(new URL("../../infra/.env", import.meta.url)),
	override: true,
});

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const DEFAULT_TAB = "Sheet1";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

async function main(): Promise<void> {
	// Diagnostic: report which GOOGLE_* names are visible + whether non-empty.
	// Prints NAMES and presence only — never the secret values.
	const googleKeys = Object.keys(process.env)
		.filter((key) => key.startsWith("GOOGLE"))
		.sort();
	process.stdout.write(
		`Visible GOOGLE_* vars: ${googleKeys.join(", ") || "(none)"}\n`
	);
	for (const name of [
		"GOOGLE_SERVICE_ACCOUNT_JSON",
		"GOOGLE_SHEET_ID",
		"GOOGLE_SHEET_TAB",
	]) {
		const value = process.env[name];
		const state = value ? `present (len ${value.length})` : "MISSING/empty";
		process.stdout.write(`  ${name}: ${state}\n`);
	}

	const credentialsJson = requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
	const spreadsheetId = requireEnv("GOOGLE_SHEET_ID");
	const tab = process.env.GOOGLE_SHEET_TAB ?? DEFAULT_TAB;

	let credentials: Record<string, unknown>;
	try {
		credentials = JSON.parse(credentialsJson);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${detail}`);
	}

	process.stdout.write(
		`Service account: ${String(credentials.client_email)}\n`
	);
	process.stdout.write(`Spreadsheet:     ${spreadsheetId}\n`);
	process.stdout.write(`Tab:             ${tab}\n`);

	const auth = new google.auth.GoogleAuth({
		credentials,
		scopes: [SHEETS_SCOPE],
	});
	const sheets = google.sheets({ version: "v4", auth });

	const response = await sheets.spreadsheets.values.append({
		spreadsheetId,
		range: `${tab}!A1`,
		valueInputOption: "RAW",
		requestBody: { values: [["test", new Date().toISOString()]] },
	});

	process.stdout.write(
		`OK — appended ${response.data.updates?.updatedRows ?? 0} row(s) to ${response.data.updates?.updatedRange}\n`
	);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`FAIL — ${message}\n`);

	const lower = message.toLowerCase();
	if (message.includes("403") || lower.includes("permission")) {
		process.stderr.write(
			"Hint: share the Sheet with the service account email (client_email) as Editor.\n"
		);
	}
	if (lower.includes("unable to parse range")) {
		process.stderr.write(
			"Hint: GOOGLE_SHEET_TAB does not match a real tab name in the Sheet.\n"
		);
	}
	if (lower.includes("not found") || message.includes("404")) {
		process.stderr.write("Hint: check GOOGLE_SHEET_ID.\n");
	}

	process.exit(1);
});
