import { periodStart } from "$lib/format/range";
import type { SeriesPoint } from "./types";

/** The longest daily range (in days) that gets each day's worst hour. */
export const WORST_HOUR_MAX_DAYS = 92;

/**
 * The highest hourly mean per Pacific day, keyed by the day's start (epoch ms). `t` is the winning
 * hour's start; the earliest hour wins a tie. A day with no hours has no entry.
 */
export function worstHours(hourly: SeriesPoint[]): Map<number, { t: number; value: number }> {
	const worst = new Map<number, { t: number; value: number }>();
	for (const p of hourly) {
		const day = periodStart(new Date(p.t), "day").getTime();
		const best = worst.get(day);
		if (!best || p.mean > best.value || (p.mean === best.value && p.t < best.t)) {
			worst.set(day, { t: p.t, value: p.mean });
		}
	}
	return worst;
}
