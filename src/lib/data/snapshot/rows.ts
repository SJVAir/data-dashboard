import { TZDate } from "@date-fns/tz";
import { TIME_ZONE, toKey } from "$lib/format";

/** The Pacific date a summary row starts on. */
export function rowDate(row: { timestamp: string }): string {
	return toKey(new TZDate(Date.parse(row.timestamp), TIME_ZONE));
}

/** A figure field's value: a finite number, else `null`. */
export function numberOf(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
