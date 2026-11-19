import type { NowSource } from "../now/client";
import type { Snapshot, SnapshotAt } from "./types";

/** A snapshot time as a primitive: `"now"`, a day's key, or `month:…` / `year:…` by its start. */
export function atKey(at: SnapshotAt): string {
	if (at === "now") return "now";
	return "day" in at ? at.day : `${at.resolution}:${at.start}`;
}

/** The snapshot time a key names (`atKey`'s inverse). */
export function atOfKey(key: string): SnapshotAt {
	if (key === "now") return "now";
	const [level, start] = key.split(":");
	if ((level === "month" || level === "year") && start) return { start, resolution: level };
	return { day: key };
}

/** A month or year stop (not now, not a day). */
export function isPeriodAt(
	at: SnapshotAt
): at is Extract<SnapshotAt, { start: string; resolution: "month" | "year" }> {
	return at !== "now" && "start" in at;
}

/**
 * A month or year stop's snapshot: no figures yet (the Map's monthly and yearly figures aren't
 * read yet), so every place draws as no data. Final, so it never polls.
 */
export function periodSnapshotSource(
	key: string
): NowSource<Snapshot> & { poll: (s: Snapshot | undefined) => boolean } {
	return {
		key,
		cadence: "hour",
		poll: () => false,
		fetch: async () => ({ figures: new Map(), final: true, unrated: false })
	};
}
