import type { sheets_v4 } from "googleapis/build/src/apis/sheets/index.js";
import {
	auth,
	sheets as createSheetsClient,
} from "googleapis/build/src/apis/sheets/index.js";
import { requireEnv } from "./process-env";

/** The Google Sheets v4 client (named to avoid a `ReturnType<typeof>` contract). */
type SheetsClient = sheets_v4.Sheets;

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const DEFAULT_SHEET_TAB = "Tracking";

/**
 * One row of the comment-tracking output Google Sheet: the lead's identity,
 * source post context, operational status, and the 2 LinkedIn DM bodies with
 * the lead's first name already substituted in. Members are alphabetical; the
 * on-sheet column order is {@link SHEET_COLUMNS}.
 */
export interface DmSheetRow {
	company: string;
	dateAdded: string;
	followUpDm: string;
	followUpDm2: string;
	leadMagnetAssetRequested: string;
	linkedinUrl: string;
	notes: string;
	personName: string;
	sourcePostUrl: string;
	status: string;
}

/**
 * Stable on-sheet column order. Headers are what Google Sheets receives when the
 * tab is empty; keys select values from {@link DmSheetRow}. Each row's DM bodies
 * already have the lead's first name substituted in (no merge tag left).
 */
const SHEET_COLUMNS = [
	{ key: "dateAdded", header: "Date Added" },
	{ key: "personName", header: "Person's Name" },
	{ key: "linkedinUrl", header: "LinkedIn URL" },
	{ key: "followUpDm", header: "LinkedIn Follow Up DM" },
	{ key: "followUpDm2", header: "LinkedIn Follow Up DM II" },
	{ key: "company", header: "Company" },
	{ key: "status", header: "Status" },
	{ key: "leadMagnetAssetRequested", header: "Lead Magnet / Asset Requested" },
	{ key: "sourcePostUrl", header: "Source Post URL" },
	{ key: "notes", header: "Notes" },
] as const satisfies readonly {
	key: keyof DmSheetRow;
	header: string;
}[];

const SHEET_HEADERS = SHEET_COLUMNS.map(({ header }) => header);

export interface AppendDmRowsResult {
	rowsWritten: number;
	sheetUrl: string;
}

/**
 * Keep the header row aligned with the current column contract. Existing tabs
 * from the old 5-column sheet are upgraded in place before appending 10-column
 * rows.
 */
async function ensureHeaderRow(
	sheets: SheetsClient,
	spreadsheetId: string,
	tab: string
): Promise<void> {
	const existing = await sheets.spreadsheets.values.get({
		spreadsheetId,
		range: `${tab}!A1:1`,
	});
	const existingHeader = existing.data.values?.[0] ?? [];
	const headerMatches =
		existingHeader.length === SHEET_HEADERS.length &&
		SHEET_HEADERS.every((header, index) => existingHeader[index] === header);

	if (headerMatches) {
		return;
	}

	await sheets.spreadsheets.values.update({
		spreadsheetId,
		range: `${tab}!A1`,
		valueInputOption: "RAW",
		requestBody: { values: [SHEET_HEADERS] },
	});
}

async function resolveSheetTab(
	sheets: SheetsClient,
	spreadsheetId: string,
	preferredTab: string
): Promise<string> {
	const metadata = await sheets.spreadsheets.get({
		spreadsheetId,
		fields: "sheets.properties.title",
	});
	const tabs =
		metadata.data.sheets
			?.map((sheet) => sheet.properties?.title)
			.filter((title): title is string => Boolean(title)) ?? [];

	if (tabs.includes(preferredTab)) {
		return preferredTab;
	}

	const [onlyTab] = tabs;
	if (onlyTab && tabs.length === 1) {
		return onlyTab;
	}

	throw new Error(
		`Sheet tab "${preferredTab}" not found. Available tabs: ${tabs.join(", ")}`
	);
}

/**
 * Append one row per lead to the configured Google Sheet. Authenticates with a
 * service account (`GOOGLE_SERVICE_ACCOUNT_JSON`) that must have edit access to
 * `GOOGLE_SHEET_ID`; the tab defaults to `Tracking` unless `GOOGLE_SHEET_TAB`
 * is set. Rows without a LinkedIn URL are dropped (they cannot be DM'd).
 */
export async function appendDmRows(
	rows: DmSheetRow[]
): Promise<AppendDmRowsResult> {
	// Defense in depth: never push a row that cannot be DM'd, even if a caller
	// forgets to filter.
	const writableRows = rows.filter((row) => row.linkedinUrl.trim() !== "");
	const spreadsheetId = requireEnv("GOOGLE_SHEET_ID");
	const tab = process.env.GOOGLE_SHEET_TAB ?? DEFAULT_SHEET_TAB;
	const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

	if (writableRows.length === 0) {
		return { sheetUrl, rowsWritten: 0 };
	}

	const credentialsJson = requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
	const credentials = JSON.parse(credentialsJson);
	const serviceAccountEmail =
		typeof credentials.client_email === "string"
			? credentials.client_email
			: "unknown service account";
	const googleAuth = new auth.GoogleAuth({
		credentials,
		scopes: [SHEETS_SCOPE],
	});
	const sheets = createSheetsClient({ version: "v4", auth: googleAuth });
	try {
		const resolvedTab = await resolveSheetTab(sheets, spreadsheetId, tab);
		await ensureHeaderRow(sheets, spreadsheetId, resolvedTab);

		const values = writableRows.map((row) =>
			SHEET_COLUMNS.map(({ key }) => row[key])
		);

		const response = await sheets.spreadsheets.values.append({
			spreadsheetId,
			range: `${resolvedTab}!A1`,
			valueInputOption: "RAW",
			requestBody: { values },
		});

		const rowsWritten =
			response.data.updates?.updatedRows ?? writableRows.length;

		return { sheetUrl, rowsWritten };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		throw new Error(
			`Google Sheets write failed for ${sheetUrl} tab "${tab}" as ${serviceAccountEmail}: ${message}`,
			{ cause: error }
		);
	}
}
