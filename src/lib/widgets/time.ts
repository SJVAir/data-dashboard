/**
 * A widget type's time, read through two questions: can its widgets show now, and does this one?
 * A now type always shows now; a range type with `now` (the Map) shows now when it has no
 * `dateRange`, else its range.
 */
import type { WidgetDataConfig } from "$lib/data/schema";
import type { WidgetType } from "./registry";

/** Whether the type's widgets can show now (a now type, or a range type with `now`). */
export function offersNow(type: WidgetType): boolean {
	return type.time === "now" || (type.time === "range" && type.now === true);
}

/** Whether this widget shows now: a now type, or a `now` type with no dateRange. */
export function showsNow(type: WidgetType, data: WidgetDataConfig): boolean {
	return type.time === "now" || (offersNow(type) && !data.dateRange);
}
