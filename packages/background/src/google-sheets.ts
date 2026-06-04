import {
	auth,
	sheets as createSheetsClient,
} from "googleapis/build/src/apis/sheets/index.js";

import { requireEnv } from "./process-env";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const DEFAULT_SHEET_TAB = "Sheet1";

/**
 * One Instantly-ready row of the output Google Sheet. Fields combine the Clay
 * lead, the resolved post-level lead magnets, and the rendered 3-email
 * sequence. Members are alphabetical; the on-sheet column order is defined by
 * {@link SHEET_COLUMNS}.
 */
export interface EmailSheetRow {
	companyDescription: string;
	companyEmployees: string;
	companyIndustry: string;
	companyLinkedin: string;
	companyName: string;
	companyUrl: string;
	country: string;
	email: string;
	email1Body: string;
	email1Subject: string;
	firstName: string;
	followUp1Body: string;
	followUp1Subject: string;
	followUp2Body: string;
	followUp2Subject: string;
	followUpOneDescription: string;
	followUpOneLeadMagnet: string;
	followUpOnePainLine: string;
	followUpTwoDescription: string;
	followUpTwoLeadMagnet: string;
	followUpTwoPainLine: string;
	name: string;
	originalComment: string;
	originalPostUrl: string;
	personalLinkedinUrl: string;
	targetedLeadMagnet: string;
	targetedLeadMagnetDescription: string;
	targetedPainLine: string;
}

/**
 * Stable on-sheet column order (matches the Instantly CSV contract). Each entry
 * is a key of {@link EmailSheetRow}; this is the single source of truth for
 * column ordering.
 */
const SHEET_COLUMNS = [
	"email",
	"firstName",
	"name",
	"companyName",
	"companyUrl",
	"companyLinkedin",
	"companyEmployees",
	"companyIndustry",
	"companyDescription",
	"country",
	"personalLinkedinUrl",
	"originalComment",
	"originalPostUrl",
	"targetedLeadMagnet",
	"targetedLeadMagnetDescription",
	"targetedPainLine",
	"followUpOneLeadMagnet",
	"followUpOneDescription",
	"followUpOnePainLine",
	"followUpTwoLeadMagnet",
	"followUpTwoDescription",
	"followUpTwoPainLine",
	"email1Subject",
	"email1Body",
	"followUp1Subject",
	"followUp1Body",
	"followUp2Subject",
	"followUp2Body",
] as const satisfies readonly (keyof EmailSheetRow)[];

export interface AppendEmailRowsResult {
	rowsWritten: number;
	sheetUrl: string;
}

/**
 * Write the column-name header row when the target tab is still empty. Instantly
 * maps CSV columns and custom variables ({@code {{firstName}}}, {@code {{email1Body}}})
 * by header text, so the sheet must carry one. A non-empty `A1` means the header
 * already exists, so later appends skip this.
 */
async function ensureHeaderRow(
	sheets: ReturnType<typeof createSheetsClient>,
	spreadsheetId: string,
	tab: string
): Promise<void> {
	const existing = await sheets.spreadsheets.values.get({
		spreadsheetId,
		range: `${tab}!A1`,
	});

	if (existing.data.values?.length) {
		return;
	}

	await sheets.spreadsheets.values.update({
		spreadsheetId,
		range: `${tab}!A1`,
		valueInputOption: "RAW",
		requestBody: { values: [[...SHEET_COLUMNS]] },
	});
}

/**
 * Append one row per lead to the configured Google Sheet for CSV export to
 * Instantly. Authenticates with a service account
 * (`GOOGLE_SERVICE_ACCOUNT_JSON`) that must have edit access to
 * `GOOGLE_SHEET_ID`; the tab defaults to `Sheet1` unless `GOOGLE_SHEET_TAB`
 * is set.
 *
 * @param rows - Rows to append, already rendered by the email-generation task.
 * @returns The Sheet URL and the number of rows written.
 * @throws If required Google environment variables are missing.
 */
export async function appendEmailRows(
	rows: EmailSheetRow[]
): Promise<AppendEmailRowsResult> {
	const credentialsJson = requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
	const spreadsheetId = requireEnv("GOOGLE_SHEET_ID");
	const tab = process.env.GOOGLE_SHEET_TAB ?? DEFAULT_SHEET_TAB;
	const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

	if (rows.length === 0) {
		return { sheetUrl, rowsWritten: 0 };
	}

	const googleAuth = new auth.GoogleAuth({
		credentials: JSON.parse(credentialsJson),
		scopes: [SHEETS_SCOPE],
	});
	const sheets = createSheetsClient({ version: "v4", auth: googleAuth });

	await ensureHeaderRow(sheets, spreadsheetId, tab);

	const values = rows.map((row) => SHEET_COLUMNS.map((key) => row[key]));

	const response = await sheets.spreadsheets.values.append({
		spreadsheetId,
		range: `${tab}!A1`,
		valueInputOption: "RAW",
		requestBody: { values },
	});

	const rowsWritten = response.data.updates?.updatedRows ?? rows.length;

	return { sheetUrl, rowsWritten };
}
