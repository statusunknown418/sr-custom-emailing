import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
	path: "../infra/.env",
});

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const databaseId =
	process.env.CLOUDFLARE_DATABASE_ID ?? process.env.CLOUDFLARE_D1_DATABASE_ID;
const token =
	process.env.CLOUDFLARE_D1_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN;

export default defineConfig({
	schema: "./src/schema",
	out: "./src/migrations",
	// DOCS: https://orm.drizzle.team/docs/guides/d1-http-with-drizzle-kit
	dialect: "sqlite",
	driver: "d1-http",
	dbCredentials: {
		accountId,
		databaseId,
		token,
	},
});
