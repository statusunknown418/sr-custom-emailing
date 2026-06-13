declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
	toBe: (expected: string) => void;
	toContain: (expected: string) => void;
	toThrow: (expected: string) => void;
};

import { renderDm3Body } from "./lead-magnet-selection";

describe("renderDm3Body", () => {
	it("renders the full approved third follow-up", () => {
		expect(renderDm3Body("senior backend engineer")).toBe(
			"Hey {{firstname}}\nSaw your hiring for a senior backend engineer - want me to run a campaign for you so you can interview candidates not active on job boards? If you hire someone, consider them yours - on the house."
		);
	});

	it("removes a leading article from model role output", () => {
		expect(renderDm3Body("a recruiter")).toContain("for a recruiter -");
	});

	it("rejects role merge tags", () => {
		expect(() => renderDm3Body("{{hardtofillrole}}")).toThrow(
			"dm3HardToFillRole must not contain merge tags"
		);
	});
});
