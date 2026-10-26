import { setOrigin, setRequestDefaults } from "@sjvair/sdk/http";

export interface SdkEnv {
	dev: boolean;
	prodUrl?: string;
}

/**
 * Point the SDK at its API origin and set the request defaults. Returns the origin it set.
 *
 * Production uses the page's own origin so cookie sign-in stays same-origin (see
 * ARCHITECTURE.md, "Deployment"); `VITE_PROD_URL` overrides it for standalone/Tauri builds.
 * Dev always uses the page origin; the Vite dev server proxies `/api/` and `/account/` to the
 * local sjvair.com stack.
 */
export function configureSdk(env: SdkEnv, pageOrigin: string): string {
	const origin = (!env.dev && env.prodUrl) || pageOrigin;
	setOrigin(origin);
	setRequestDefaults({ credentials: "same-origin" });
	return origin;
}
