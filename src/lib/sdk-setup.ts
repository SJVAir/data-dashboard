import { setOrigin, setRequestDefaults } from "@sjvair/sdk/http";

export interface SdkEnv {
	dev: boolean;
	devUrl?: string;
	prodUrl?: string;
}

/**
 * Point the SDK at its API origin and set the request defaults. Returns the origin it set.
 *
 * Production uses the page's own origin so cookie sign-in stays same-origin (see
 * ARCHITECTURE.md, "Deployment"); `VITE_PROD_URL` overrides it for standalone/Tauri builds.
 * In dev, `VITE_DEV_URL` wins, else the page origin (until the dev proxy exists).
 */
export function configureSdk(env: SdkEnv, pageOrigin: string): string {
	const override = env.dev ? env.devUrl : env.prodUrl;
	const origin = override || pageOrigin;
	setOrigin(origin);
	setRequestDefaults({ credentials: "same-origin" });
	return origin;
}
