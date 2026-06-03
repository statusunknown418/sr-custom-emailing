import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "@trigger.dev/sdk";
import { config } from "dotenv";

config({ path: fileURLToPath(new URL("../infra/.env", import.meta.url)) });
const project = process.env.TRIGGER_PROJECT_REF;

if (!project) {
	throw new Error(
		"TRIGGER_PROJECT_REF is required to run or deploy Trigger.dev tasks"
	);
}

export default defineConfig({
	project,
	maxDuration: 300,
	dirs: ["./src/trigger"],
});
