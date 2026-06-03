/** biome-ignore-all lint/style/noNamespace: CF */
import type { server } from "@sr-custom-emailing/infra/alchemy.run";

// This file infers types for the cloudflare:workers environment from your Alchemy Worker.
// @see https://alchemy.run/concepts/bindings/#type-safe-bindings

export type CloudflareEnv = typeof server.Env;

declare global {
	type Env = CloudflareEnv;
}

declare module "cloudflare:workers" {
	namespace Cloudflare {
		export interface Env extends CloudflareEnv {
			ANTHROPIC_API_KEY: string;
			APIFY_API_KEY: string;
			CLAY_API_KEY: string;
			CORS_ORIGIN: string;
			INSTANTLY_API_KEY: string;
			TRIGGER_SECRET_KEY: string;
		}
	}
}
