/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_DEV_URL?: string;
	readonly VITE_PROD_URL?: string;
	/** The dashboard's Sentry project DSN; unset = error reporting off. */
	readonly VITE_SENTRY_DSN?: string;
}

/** The git commit this build came from (`"dev"` under `vite dev`); set by the build-info plugin. */
declare const __BUILD_ID__: string;
