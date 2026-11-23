import type { SnapshotAt } from "./types";

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
