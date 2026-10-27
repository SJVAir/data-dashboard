import { m } from "$lib/paraglide/messages.js";
import { setPlatform } from "$lib/platform";
import { report } from "$lib/safety/report";
import type { Platform } from "$lib/platform/types";

export type BootOptions = {
	target: HTMLElement;
	createPlatform: (options: { onBlocked: () => void }) => Promise<Platform>;
	/** Sets up the app on the platform and mounts it into `target`. */
	start: (platform: Platform) => Promise<void>;
};

/** A plain message in place of the app (no app code has run, so no components). */
function showMessage(target: HTMLElement, text: string): void {
	const p = document.createElement("p");
	p.className = "text-foreground mx-auto max-w-prose p-4";
	p.textContent = text;
	target.replaceChildren(p);
}

/**
 * Opens storage and starts the app. If storage can't be opened (site data disabled, some
 * private modes, quota errors) the page says so instead of staying blank; while another tab's
 * older connection holds the open up, it asks for the other tabs to be closed.
 */
export async function boot({ target, createPlatform, start }: BootOptions): Promise<void> {
	let platform: Platform;
	try {
		platform = await createPlatform({
			onBlocked: () => showMessage(target, m.storage_blocked())
		});
	} catch (error) {
		console.error(error);
		showMessage(target, m.storage_unavailable());
		return;
	}
	setPlatform(platform);
	target.replaceChildren();
	try {
		await start(platform);
	} catch (error) {
		console.error(error);
		report(error, { operation: "start" });
		showMessage(target, m.startup_failed());
	}
}
