import type { ActivitySource } from "$lib/platform/types";
import type { UpdateNotice } from "./update-notice.svelte";

export type VersionCheckOptions = {
	activity: ActivitySource;
	buildId: string;
	fetchBuildId: () => Promise<string>;
	notice: Pick<UpdateNotice, "show">;
	intervalMs?: number;
};

/**
 * Compares the deployed build id with this tab's when the tab becomes visible and once an hour
 * while visible. A failed fetch is ignored. Does nothing in development. Returns a stop function.
 */
export function startVersionCheck(opts: VersionCheckOptions): () => void {
	const { activity, buildId, fetchBuildId, notice, intervalMs = 3_600_000 } = opts;
	if (buildId === "dev") return () => {};
	let stopped = false;

	async function check(): Promise<void> {
		try {
			const latest = await fetchBuildId();
			if (!stopped && latest !== buildId) notice.show("new-version");
		} catch {
			// Offline or the file is missing: try again next time.
		}
	}

	const unsubscribe = activity.onChange((visible) => {
		if (visible) void check();
	});
	const timer = setInterval(() => {
		if (activity.visible()) void check();
	}, intervalMs);
	return () => {
		stopped = true;
		unsubscribe();
		clearInterval(timer);
	};
}
