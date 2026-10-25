import { updateNotice } from "./update-notice.svelte";

/** Runs a lazy import; if the file is gone (an older deploy's chunk), offers a reload. */
export async function loadLazy<T>(load: () => Promise<T>): Promise<T> {
	try {
		return await load();
	} catch (error) {
		updateNotice.show("chunk-failed");
		throw error;
	}
}
