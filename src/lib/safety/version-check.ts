import type { ActivitySource } from "$lib/platform/types";
import type { UpdateNotice } from "./update-notice.svelte";

/**
 * The deployed build id from a `version.json` response; throws (a failed check, so no bar) for an
 * error status or a body without a string `buildId`, such as an HTML fallback page.
 */
export async function parseBuildId(response: Pick<Response, "ok" | "json">): Promise<string> {
	if (!response.ok) throw new Error("version.json couldn't be fetched");
	const body: unknown = await response.json();
	const buildId = typeof body === "object" && body !== null ? Reflect.get(body, "buildId") : null;
	if (typeof buildId !== "string" || buildId === "")
		throw new Error("version.json has no build id");
	return buildId;
}

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
