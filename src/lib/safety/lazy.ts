import { updateNotice } from "./update-notice.svelte";

/**
 * Runs a lazy import; if the file is gone (an older deploy's chunk), offers a reload and rethrows.
 * A load that resolves to nothing (a swallowed preload error) counts as gone too.
 */
export async function loadLazy<T>(load: () => Promise<T>): Promise<T> {
	try {
		const loaded = await load();
		if (loaded === undefined || (Array.isArray(loaded) && loaded.includes(undefined))) {
			throw new Error("A lazily loaded file resolved to nothing");
		}
		return loaded;
	} catch (error) {
		updateNotice.show("chunk-failed");
		throw error;
	}
}
