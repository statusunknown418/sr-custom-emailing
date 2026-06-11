import { fileURLToPath, URL } from "node:url";
import alchemy from "alchemy";
import { D1Database, Worker } from "alchemy/cloudflare";
import { config } from "dotenv";

// Worker-side secrets live in packages/infra/.env. Load them for every phase
// (deploy and destroy too, not just dev) so `alchemy.env.*` resolves. Resolve
// relative to this file, not cwd, so the path holds however the script is run.
config({
	override: false,
	path: fileURLToPath(new URL("./.env", import.meta.url)),
});

const isDev = process.argv.includes("--dev");

if (isDev) {
	// Local dev also layers in the server app's env (e.g. CORS_ORIGIN override).
	config({
		override: false,
		path: fileURLToPath(new URL("../../apps/server/.env", import.meta.url)),
	});
}

const app = await alchemy("sr-custom-emailing");

const db = await D1Database("database", {
	adopt: true,
	migrationsDir: "../../packages/db/src/migrations",
});

export const server = await Worker("server", {
	adopt: true,
	cwd: "../../apps/server",
	entrypoint: "src/index.ts",
	compatibility: "node",
	bindings: {
		DB: db,
		CORS_ORIGIN: alchemy.env.CORS_ORIGIN ?? "",
		TRIGGER_SECRET_KEY: alchemy.secret(alchemy.env.TRIGGER_SECRET_KEY),
		INTERNAL_API_SECRET: alchemy.secret(alchemy.env.INTERNAL_API_SECRET),
		APIFY_WEBHOOK_SECRET: alchemy.secret(alchemy.env.APIFY_WEBHOOK_SECRET),
		DISCORD_PUBLIC_KEY: alchemy.env.DISCORD_PUBLIC_KEY ?? "",
		MAKE_WEBHOOK_URL: alchemy.env.MAKE_WEBHOOK_URL ?? "",
	},
	dev: {
		port: 3000,
	},
});

console.log(`Server -> ${server.url}`);

await app.finalize();
