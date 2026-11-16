import { pacificDay, parseDateKey } from "$lib/format";
import { resolveRange, type DateRangeSpec } from "$lib/format/range";

export type Stop = { day: string } | "now";

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD` plus `days`, by calendar (UTC) arithmetic so a DST change never shifts a day. */
function plusDays(date: string, days: number): string {
	const { y, m, d } = parseDateKey(date);
	return new Date(Date.UTC(y, m - 1, d) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The range's stops: each Pacific day up to today, then "now" if the range includes today. */
export function dayStops(range: DateRangeSpec, today: string): Stop[] {
	const r = resolveRange(range, pacificDay(today, 12));
	const stops: Stop[] = [];
	for (let d = r.firstDate; d < today && d <= r.lastDate; d = plusDays(d, 1)) {
		stops.push({ day: d });
	}
	if (r.firstDate <= today && today <= r.lastDate) stops.push("now");
	return stops;
}

/** The stop to show: the saved day when it is a stop, else the last stop (null: no stops). */
export function openStop(saved: string | undefined, stops: Stop[]): Stop | null {
	if (stops.length === 0) return null;
	const found = saved === undefined ? undefined : stops.find((s) => s !== "now" && s.day === saved);
	return found ?? stops[stops.length - 1];
}

/** The option value for a stop: the last stop is stored as missing. */
export function dayOption(stop: Stop, stops: Stop[]): string | undefined {
	const last = stops[stops.length - 1];
	if (stop === "now" ? last === "now" : last !== "now" && last?.day === stop.day) return undefined;
	return stop === "now" ? undefined : stop.day;
}

/** The stop a key moves to (slider pattern); null for keys it doesn't handle. */
export function stepKey(key: string, at: number, count: number): number | null {
	const clamp = (i: number) => Math.min(Math.max(i, 0), count - 1);
	switch (key) {
		case "ArrowLeft":
		case "ArrowDown":
			return clamp(at - 1);
		case "ArrowRight":
		case "ArrowUp":
			return clamp(at + 1);
		case "PageDown":
			return clamp(at - 7);
		case "PageUp":
			return clamp(at + 7);
		case "Home":
			return 0;
		case "End":
			return count - 1;
		default:
			return null;
	}
}
