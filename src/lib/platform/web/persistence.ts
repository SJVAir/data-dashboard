import type { PersistenceAccess, Protection } from "../types";

const toProtection = (granted: boolean): Protection => (granted ? "protected" : "unprotected");

/**
 * Whether the browser may evict stored data. `prompts()` is a user-agent check: no feature check
 * tells browsers that ask the person from those that decide silently (the Permissions API says
 * "prompt" in Chrome too), and only Firefox asks.
 */
export function createWebPersistence(nav: Navigator = navigator): PersistenceAccess {
	return {
		async persisted() {
			try {
				if (!nav.storage?.persisted) return "unknown";
				return toProtection(await nav.storage.persisted());
			} catch {
				return "unknown";
			}
		},
		async request() {
			try {
				if (!nav.storage?.persist) return "unknown";
				return toProtection(await nav.storage.persist());
			} catch {
				return "unknown";
			}
		},
		prompts: () => /\bFirefox\//.test(nav.userAgent)
	};
}
