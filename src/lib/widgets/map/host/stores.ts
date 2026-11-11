import { createDefaultMetadata, type MetadataProvider } from "@sjvair/map-sdk/data";
import { createMonitorsStore, type MonitorsStore } from "@sjvair/map-sdk/stores";
import { platform } from "$lib/platform";

let metadata: MetadataProvider | undefined;

/** One metadata provider for every map on the page, so two maps don't fetch metadata twice. */
export function sharedMetadata(): MetadataProvider {
	metadata ??= createDefaultMetadata();
	return metadata;
}

type Shared = { store: MonitorsStore; holders: number; stopWatching: () => void };

const shared = new Map<string, Shared>();

/**
 * The page's monitors store for an entry type, shared by every map showing it: created and
 * loaded on the first acquire, paused while the page is hidden, and disposed after the last
 * `release()`. A map that wants the load's outcome awaits `store.init(entryType)` itself (it
 * joins the same run).
 */
export function acquireMonitors(entryType: string): { store: MonitorsStore; release(): void } {
	let entry = shared.get(entryType);
	if (!entry) {
		const store = createMonitorsStore();
		const { activity } = platform();
		const sync = (visible: boolean) => {
			if (visible) store.resumeAutoUpdate();
			else store.pauseAutoUpdate();
		};
		const created: Shared = { store, holders: 0, stopWatching: activity.onChange(sync) };
		entry = created;
		shared.set(entryType, created);
		// Polling starts when the load finishes, so a page hidden by then pauses it again.
		store.init(entryType).then(
			() => {
				if (shared.get(entryType) === created && !activity.visible()) store.pauseAutoUpdate();
			},
			() => {}
		);
	}
	const held = entry;
	held.holders++;
	let released = false;
	return {
		store: held.store,
		release() {
			if (released) return;
			released = true;
			held.holders--;
			if (held.holders > 0) return;
			held.stopWatching();
			held.store.dispose();
			if (shared.get(entryType) === held) shared.delete(entryType);
		}
	};
}
