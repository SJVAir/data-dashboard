import { setOrigin, setRequestDefaults } from "@sjvair/sdk/http";

export interface SdkEnv {
	DEV: boolean;
	VITE_DEV_URL?: string;
	VITE_PROD_URL?: string;
}

/**
 * Point the SDK at its API origin and set the request defaults. Returns the origin it set.
 *
 * Production uses the page's own origin so cookie sign-in stays same-origin (see
 * ARCHITECTURE.md, "Deployment"); `VITE_PROD_URL` overrides it for standalone/Tauri builds.
 * In dev, `VITE_DEV_URL` wins, else the page origin (until the dev proxy exists).
 */
export function configureSdk(env: SdkEnv, pageOrigin: string): string {
	const override = env.DEV ? env.VITE_DEV_URL : env.VITE_PROD_URL;
	const origin = override || pageOrigin;
	setOrigin(origin);
	setRequestDefaults({ credentials: "same-origin" });
	return origin;
}
