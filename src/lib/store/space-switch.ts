/**
 * Keeping a tab in the space of whoever is signed in. When the identity's space stops being the
 * app's (signed in or out in any tab, an expired session, another account), the old account
 * space is hidden, never deleted, and the app is remounted in the new space.
 */
import type { Identity } from "$lib/account/identity";
import type { SpaceId } from "$lib/platform/types";
import { report } from "$lib/safety/report";
import type { AppContext } from "./app.svelte";
import { hideSpace, spaceFor } from "./spaces";

/** Calls `onSwitch(next)` once when the identity's space stops being `app.space`, after hiding it. */
export function watchSpace(app: AppContext, onSwitch: (next: SpaceId) => void): () => void {
	const { platform } = app;
	let done = false;
	const changed = (identity: Identity) => {
		if (done || identity.state === "unknown") return;
		const next = spaceFor(identity);
		if (next === app.space) return;
		done = true;
		stop();
		void (async () => {
			if (app.space !== "anonymous") {
				// A tab that signed out on purpose hid it already, and that reason stays.
				const reason = identity.state === "signed-out" ? "expired" : "switched";
				try {
					await hideSpace(platform, app.space, reason, new Date());
				} catch (error) {
					// Still switched: the next person mustn't see this space now.
					report(error, { operation: "space-hide" });
				}
			}
			onSwitch(next);
		})();
	};
	const stop = platform.identity.onChange(changed);
	// It may have changed while the app was opening.
	changed(platform.identity.current());
	return () => {
		done = true;
		stop();
	};
}

/** How a tab's app is put on screen and taken off it. */
export type SpaceHost = {
	open(): Promise<AppContext>;
	mount(app: AppContext): void;
	unmount(): void;
	/** Opening the new space failed (reported already); nothing is mounted. */
	failed?(error: unknown): void;
};

/**
 * Follows the identity from `first` on: each switch unmounts the app, closes it (storing every
 * open session's edits and stopping its sync), opens the new space, and mounts it.
 */
export function keepInSpace(
	first: AppContext,
	host: SpaceHost
): { readonly app: AppContext; stop(): void } {
	let app = first;
	let stopped = false;
	let unwatch = () => {};

	const watch = () => {
		unwatch = watchSpace(app, () => void remount());
	};

	async function remount(): Promise<void> {
		try {
			// Off screen first, so nothing on it reopens a dashboard in the app being closed.
			host.unmount();
			await app.close();
			if (stopped) return;
			app = await host.open();
			if (stopped) return void app.close();
			host.mount(app);
			watch();
		} catch (error) {
			report(error, { operation: "space-switch" });
			host.failed?.(error);
		}
	}

	watch();
	return {
		get app() {
			return app;
		},
		stop() {
			stopped = true;
			unwatch();
		}
	};
}
