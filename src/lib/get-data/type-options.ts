import type { Level } from "$lib/data/metadata";
import type { NowAlert } from "./NowControls.svelte";

/** The level line has something to show: a scale with levels, or the "unavailable" retry. */
export function hasLevelLine(levels: Level[] | "unavailable" | null | undefined): boolean {
	return levels === "unavailable" || (Array.isArray(levels) && levels.length > 0);
}

/** Some pollutant has an alert level to show (levels, or the "unavailable" retry). */
export function hasAlertLevels(alerts: NowAlert[]): boolean {
	return alerts.some((a) => hasLevelLine(a.levels));
}
