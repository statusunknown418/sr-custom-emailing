import alchemy from "alchemy";
import { D1Database, Worker } from "alchemy/cloudflare";
import { config } from "dotenv";

config({ path: "./.env" });
config({ path: "../../apps/server/.env" });

const app = await alchemy("sr-custom-emailing");

const db = await D1Database("database", {
	adopt: true,
	migrationsDir: "../../packages/db/src/migrations",
});

export const server = await Worker("server", {
	cwd: "../../apps/server",
	entrypoint: "src/index.ts",
	compatibility: "node",
	bindings: {
		DB: db,
		CORS_ORIGIN: alchemy.env.CORS_ORIGIN ?? "",
		TRIGGER_SECRET_KEY: alchemy.env.TRIGGER_SECRET_KEY ?? "",
		INTERNAL_API_SECRET: alchemy.env.INTERNAL_API_SECRET ?? "",
	},
	dev: {
		port: 3000,
	},
});

console.log(`Server -> ${server.url}`);

await app.finalize();
