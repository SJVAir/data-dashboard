import type { Level } from "$lib/data/metadata";
import { ratedForCount, thresholdCount, type DayState } from "./day-state";

export type SelectionSummary = {
	start: string;
	end: string;
	days: number;
	unrated: number;
	average: number | null;
	worst: DayState | null;
	atOrAbove: number | null;
};

/** The summary of `states` (already limited to the selection, in date order). */
export function selectionSummary(states: DayState[], level: Level | null): SelectionSummary {
	const counted = states.filter(ratedForCount);
	let worst: DayState | null = null;
	let sum = 0;
	for (const s of counted) {
		sum += s.value!;
		if (worst === null || s.value! > worst.value!) worst = s;
	}
	return {
		start: states[0]?.date ?? "",
		end: states[states.length - 1]?.date ?? "",
		days: states.length,
		unrated: states.length - counted.length,
		average: counted.length ? sum / counted.length : null,
		worst,
		atOrAbove: level ? thresholdCount(states, level).at : null
	};
}
