import { expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BYTES_PER_MEB = 1024 * 1024;
const MAX_IMPORT_RSS_BYTES = 96 * BYTES_PER_MEB;
const packageRoot = fileURLToPath(new URL("..", import.meta.url));

it("loads the Sheets helper without importing every Google API client", () => {
	const result = spawnSync(
		"bun",
		[
			"--smol",
			"-e",
			"await import('./src/google-sheets.ts'); process.stdout.write(JSON.stringify(process.memoryUsage()))",
		],
		{
			cwd: packageRoot,
			encoding: "utf8",
		}
	);

	expect(result.status, result.stderr).toBe(0);

	const usage = JSON.parse(result.stdout);
	expect(usage.rss).toBeLessThan(MAX_IMPORT_RSS_BYTES);
});
