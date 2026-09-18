import type { SJVAirEntryLevel } from "@sjvair/sdk";
import { getCurrentLevel } from "$lib/calendar";

export function buildRegionFillColors(
	regionMeans: Map<string, number>,
	levels: Array<SJVAirEntryLevel> | null
): Map<string, string> {
	const colors = new Map<string, string>();
	if (!levels) return colors;

	for (const [regionId, mean] of regionMeans) {
		const level = getCurrentLevel(mean, levels);
		if (level) colors.set(regionId, level.color);
	}

	return colors;
}
