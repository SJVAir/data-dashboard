import type { AppContext } from "$lib/store/app.svelte";

/**
 * Removes everything this browser holds for the workspace (for a shared computer). The new
 * generation is written first, so other tabs' pending saves and journal writes become no-ops;
 * they are told to start over, and so does this tab.
 */
export async function clearMyData(app: AppContext): Promise<void> {
	const { platform } = app;
	await platform.reset.clearAll();
	app.channel.post({ type: "cleared", generation: platform.reset.generation(), tabId: app.tabId });
	await app.resetAfterClear();
}
