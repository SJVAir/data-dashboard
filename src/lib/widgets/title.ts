import type { DateRangeSpec } from "$lib/data/schema";
import type { PlaceInfo } from "$lib/data/types";
import {
	formatDate,
	formatDateRange,
	formatMonth,
	formatNumber,
	formatYear,
	startOfPacificWeek
} from "$lib/format";
import type { PlaceViewer } from "./shared/viewer";
import { m } from "$lib/paraglide/messages.js";

/** A count as message inputs: the formatted number to show and the number to pick the plural. */
function counted(n: number): { count: string; countValue: number } {
	return { count: formatNumber(n), countValue: n };
}

/** "Last 30 days", "October 2026", "This month so far", "Oct 1 – 14, 2026", … */
export function rangeLabel(spec: DateRangeSpec): string {
	switch (spec.kind) {
		case "set":
			switch (spec.unit) {
				case "year":
					return formatYear(spec.start);
				case "month":
					return formatMonth(spec.start);
				case "week":
					return m.range_set_week({ date: formatDate(startOfPacificWeek(spec.start)) });
				case "day":
					return formatDate(spec.start);
			}
			break;
		case "to-date":
			switch (spec.unit) {
				case "year":
					return m.range_to_date_year();
				case "month":
					return m.range_to_date_month();
				case "week":
					return m.range_to_date_week();
			}
			break;
		case "trailing":
			switch (spec.unit) {
				case "hour":
					return m.range_trailing_hour(counted(spec.amount));
				case "day":
					return m.range_trailing_day(counted(spec.amount));
				case "month":
					return m.range_trailing_month(counted(spec.amount));
			}
			break;
		case "custom":
			return formatDateRange(spec.start, spec.end);
	}
}

/**
 * A place's label: its name, and for a point or a school the region it shows data through
 * ("ZIP 93721 (your location)", "ZIP 93702 (Roosevelt High School)"). A point is "your location"
 * to its owner and "shared location" to anyone opening a share link; its coordinates never appear.
 */
export function placeLabel(info: PlaceInfo, viewer: PlaceViewer): string {
	const region = info.name;
	switch (info.via?.kind) {
		case "point":
			return viewer === "shared"
				? m.place_via_point_shared({ region })
				: m.place_via_point_mine({ region });
		case "location":
			return m.place_via_location({ region, location: info.via.name });
		default:
			return region;
	}
}

/**
 * A data widget's generated title: "PM2.5 · Fresno County · Last 30 days", or with several
 * places "PM2.5 · 3 places · Last 30 days".
 */
export function dataTitle(parts: {
	entryLabel: string;
	places: PlaceInfo[];
	range: DateRangeSpec;
	viewer?: PlaceViewer;
}): string {
	const viewer = parts.viewer ?? "owner";
	const entry = parts.entryLabel;
	const range = rangeLabel(parts.range);
	if (parts.places.length === 0) return m.widget_title_no_place({ entry, range });
	if (parts.places.length === 1) {
		return m.widget_title_place({ entry, place: placeLabel(parts.places[0], viewer), range });
	}
	return m.widget_title_places({ entry, range, ...counted(parts.places.length) });
}
