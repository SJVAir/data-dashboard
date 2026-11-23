import { LEVELS, layerOffers, type Level, type PlaceKind } from "$lib/data/dataset-rules";
import type { CatalogEntry } from "$lib/data/metadata";
import type { DateRangeSpec, Layer, WidgetDataConfig } from "$lib/data/schema";
import { calendarSpanDays, resolveRange } from "$lib/format/range";

export type ResolutionChoice = {
	level: "auto" | Level;
	/** Why it can't be chosen: the point budget, or a chosen layer that isn't reported at it. */
	blocked: "too-many-points" | { notOffered: Layer } | null;
};

/**
 * The most points (places × periods) a preview is asked to draw. No level has a range cap of
 * its own: the server's per-request caps (31 days of raw or hourly) are met by the adapters,
 * which ask a calendar month (or 31 raw days) at a time.
 */
export const MAX_POINTS = 50_000;

/** Periods per day at each level; raw assumes a reading every two minutes (PurpleAir's rate). */
const PER_DAY: Record<Level, number> = {
	raw: 720,
	hour: 24,
	day: 1,
	month: 1 / 30,
	year: 1 / 365
};

/**
 * The "Data resolution" choices for `data`'s layers over `range` at `places` places: Automatic,
 * then every level in `within` (default all), finest first. A level is greyed, never hidden: when
 * a chosen layer isn't reported at it (`layerOffers`, the first such layer named), else when the
 * point budget rules it out. `null` when the widget type pins its resolution (the control is
 * hidden).
 */
export function resolutionChoices(args: {
	data: WidgetDataConfig;
	catalog: CatalogEntry[];
	place: PlaceKind;
	range: DateRangeSpec;
	places: number;
	pin: Level | undefined;
	now: Date;
	within?: readonly Level[];
}): ResolutionChoice[] | null {
	const { data, catalog, place, range, places, pin, now, within = LEVELS } = args;
	if (pin) return null;
	const days = calendarSpanDays(range, resolveRange(range, now));
	const offers = data.layers.map((layer) => ({
		layer,
		levels: layerOffers(layer, catalog, place)
	}));
	const choices: ResolutionChoice[] = [{ level: "auto", blocked: null }];
	for (const level of LEVELS) {
		if (!within.includes(level)) continue;
		const misfit = offers.find((o) => !o.levels.includes(level));
		const points = Math.max(1, places) * days * PER_DAY[level];
		choices.push({
			level,
			blocked: misfit
				? { notOffered: misfit.layer }
				: points > MAX_POINTS
					? "too-many-points"
					: null
		});
	}
	return choices;
}
