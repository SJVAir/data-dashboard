import type { AppContext } from "$lib/store/app.svelte";

/**
 * Removes everything this browser holds for the workspace (for a shared computer). The new
 * generation is written first, so other tabs' pending saves and journal writes become no-ops;
 * they are told to start over, and so does this tab. The theme goes back to Match my device:
 * clearing removed the saved choice, and setting it tells this tab's theme state (other tabs
 * hear the removal as a `storage` event).
 */
export async function clearMyData(app: AppContext): Promise<void> {
	const { platform } = app;
	await platform.reset.clearAll();
	platform.display.setTheme("system");
	app.channel.post({ type: "cleared", generation: platform.reset.generation(), tabId: app.tabId });
	await app.resetAfterClear();
}
