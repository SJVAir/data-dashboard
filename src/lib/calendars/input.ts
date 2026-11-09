import type { CatalogEntry } from "$lib/data/metadata";
import type { WidgetDataConfig } from "$lib/data/schema";
import type { QueryInput } from "$lib/data/types";
import { DEFAULT_RANGE } from "$lib/widgets/defaults";
import {
	CALENDAR_DEFAULT_RANGES,
	CONTRIBUTION_CALENDAR_TYPE,
	isCalendarType,
	MONTH_CALENDAR_TYPE
} from "./types";
import { mainLayer } from "$lib/widgets/shared/input";

export { CALENDAR_DEFAULT_RANGES, CONTRIBUTION_CALENDAR_TYPE, isCalendarType, MONTH_CALENDAR_TYPE };

/**
 * What a calendar asks the query client for: its main layer over the widget's range (or the
 * type's default), one row per day. A layer with no place asks for nothing (null).
 */
export function calendarInput(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined,
	type: string = MONTH_CALENDAR_TYPE
): QueryInput | null {
	const layer = mainLayer(data, catalog);
	if (!layer || (!layer.place && !layer.selection)) return null;
	return {
		layer,
		dateRange: data.dateRange ?? CALENDAR_DEFAULT_RANGES[type] ?? DEFAULT_RANGE,
		pin: "day"
	};
}
