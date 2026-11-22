import type { CatalogEntry } from "$lib/data/metadata";
import {
	MonitorRefSchema,
	PlaceRefSchema,
	type Layer,
	type WidgetDataConfig
} from "$lib/data/schema";
import type { PlaceInfo, QueryInput, QueryLayer, Series } from "$lib/data/types";
import { fromWhere, type Picks } from "$lib/places/selection";
import { sameRef } from "$lib/places/types";
import { z } from "$lib/zod";
import { mainLayer } from "./input";

/** A Chart or Data table shows at most this many overlays (for readability). */
export const MAX_OVERLAYS = 2;

/** The widget's overlays: its layers with an entry type other than the main one, in order. */
export function overlayLayers(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined
): Layer[] {
	const main = mainLayer(data, catalog);
	return data.layers.filter((l) => l !== main && l.entryType).slice(0, MAX_OVERLAYS);
}

/**
 * What an overlay asks for: its own dataset, entry type, station and filters at the main layer's
 * places (its Where, and its searched monitors: overlays store none), over the main's date range
 * and sub-range, at the main's resolution (the dataset's: every layer is fetched at it). No worst
 * hour: that is about the main layer's values.
 */
export function overlayInput(main: QueryInput, overlay: QueryLayer): QueryInput {
	const layer: QueryLayer = { dataset: overlay.dataset, entryType: overlay.entryType };
	if (overlay.station) layer.station = overlay.station;
	if (overlay.filters) layer.filters = overlay.filters;
	if (main.layer.place) layer.place = main.layer.place;
	if (main.layer.selection) layer.selection = main.layer.selection;
	if (main.layer.monitors) layer.monitors = main.layer.monitors;
	const input: QueryInput = { layer, dateRange: main.dateRange, resolution: main.resolution };
	if (main.timeSubRange) input.timeSubRange = main.timeSubRange;
	return input;
}

/**
 * A Chart's own options (saved on the widget, not on a layer): `overlayFor` is one line's place
 * (a Where area) or monitor (spec decision 37: one of the monitors the main draws, ticked or
 * searched; not a Where place).
 */
export const ChartOptionsSchema = z.object({
	overlayFor: z.union([PlaceRefSchema, MonitorRefSchema]).optional()
});

/** The saved `overlayFor`, if the options parse. */
function savedOverlayFor(options: unknown): z.infer<typeof ChartOptionsSchema>["overlayFor"] {
	const parsed = ChartOptionsSchema.safeParse(options);
	return parsed.success ? parsed.data.overlayFor : undefined;
}

/** Whether a main layer asks for monitors (ticked types or searched): its lines are monitors. */
export function monitorMain(layer: Pick<QueryLayer, "monitors" | "monitorTypes">): boolean {
	return (layer.monitors?.length ?? 0) > 0 || (layer.monitorTypes?.length ?? 0) > 0;
}

/** The monitor id of a series place key (`monitor:<id>`), or undefined for any other place. */
function monitorOf(place: string): string | undefined {
	return place.startsWith("monitor:") ? place.slice("monitor:".length) : undefined;
}

/** Whether a main layer has ticked monitor types: a monitor set, which may hold hundreds. */
function monitorSet(layer: Pick<QueryLayer, "monitorTypes">): boolean {
	return (layer.monitorTypes?.length ?? 0) > 0;
}

/**
 * The monitor a monitor set's overlays are fetched for (spec decision 37): the saved
 * `overlayFor` monitor when it's among the set's loaded monitors (`places`), else the first.
 * `null` before the set has loaded, or with no monitors.
 */
export function overlayMonitor(options: unknown, places?: PlaceInfo[]): string | null {
	const ids = (places ?? []).flatMap((p) => monitorOf(p.place) ?? []);
	const saved = savedOverlayFor(options);
	if (saved?.kind === "monitor" && ids.includes(saved.id)) return saved.id;
	return ids[0] ?? null;
}

/**
 * Whether a main asks for everywhere: no Where and no monitors (every weather station, the
 * valley's pesticide use). Its overlays aren't fetched: an everywhere overlay has no line of the
 * main's to pair with (`overlayInputsFor`; `noWhereNotes` says why).
 */
export function everywhereMain(main: QueryInput | null): boolean {
	if (!main) return false;
	const { place, selection } = main.layer;
	return !place && !selection && !monitorMain(main.layer);
}

/**
 * A widget's overlay inputs as fetched (`base`: `widgetInputs`' overlays at the main's places).
 * A monitor set's (ticked types) are fetched for one of its monitors (`overlayMonitor`), never
 * per monitor: a set can hold hundreds. `null` until the set has loaded. Areas keep theirs, and
 * searched monitors theirs (one per line: "Overlay for" picks among them), once the main has
 * loaded only those it fetched (`places`: a searched monitor that doesn't measure the pollutant
 * has no line, so no overlay). An everywhere main's (`everywhereMain`) are never fetched: the
 * whole layer is for main layers only.
 */
export function overlayInputsFor(
	main: QueryInput | null,
	base: (QueryInput | null)[],
	options: unknown,
	places?: PlaceInfo[]
): (QueryInput | null)[] {
	if (everywhereMain(main)) return base.map(() => null);
	if (!main) return base;
	if (!monitorSet(main.layer)) return searchedFetched(main, base, places);
	const id = overlayMonitor(options, places);
	return base.map((input) => {
		if (!input || !id) return null;
		// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the monitor stands in
		const { place, selection, monitors, ...own } = input.layer;
		return { ...input, layer: { ...own, monitors: [id] } };
	});
}

/**
 * Searched monitors' overlay inputs, asking only for the monitors the main fetched (its loaded
 * `places`, the same monitors `measuring` in the targets adapter keeps). Unchanged before the
 * main loads, or when it fetched every searched monitor.
 */
function searchedFetched(
	main: QueryInput,
	base: (QueryInput | null)[],
	places: PlaceInfo[] | undefined
): (QueryInput | null)[] {
	const searched = main.layer.monitors ?? [];
	if (!places || searched.length === 0) return base;
	const fetched = new Set(places.flatMap((p) => monitorOf(p.place) ?? []));
	const kept = searched.filter((id) => fetched.has(id));
	if (kept.length === searched.length) return base;
	return base.map((input) => {
		if (!input) return null;
		if (kept.length === 0) return null;
		return { ...input, layer: { ...input.layer, monitors: kept } };
	});
}

/**
 * Whether an overlay's places pair with the main's by key rather than by request index (a
 * point's region can differ by dataset): the main's lines are all monitors (an overlay at a
 * monitor keeps its key, so a monitor the overlay has and the main doesn't never takes another's
 * column), or each overlay place is one of the main's (a monitor set's overlay, fetched for one
 * of its monitors).
 */
export function pairsByKey(main: PlaceInfo[], overlay: PlaceInfo[]): boolean {
	if (main.length > 0 && main.every((p) => monitorOf(p.place) !== undefined)) return true;
	const keys = new Set(main.map((p) => p.place));
	return overlay.length > 0 && overlay.every((p) => keys.has(p.place));
}

/**
 * The refs of a Chart's lines, in order: its searched monitors when it has any (one line each),
 * else its Where's places.
 */
export function lineRefs(where: Pick<QueryLayer, "place" | "selection" | "monitors">): Picks {
	const monitors = where.monitors ?? [];
	if (monitors.length > 0) return monitors.map((id) => ({ kind: "monitor" as const, id }));
	return fromWhere(where);
}

/**
 * The place whose overlay the Chart draws, as a `PlaceInfo.place` key of `places` (one per pick,
 * in pick order; a monitor set's are its monitors): the saved `overlayFor` when it's among them,
 * else the first place. Options that don't parse are ignored. `""` when there are no places.
 */
export function overlayPlaceFor(options: unknown, places: PlaceInfo[], picks: Picks): string {
	const saved = savedOverlayFor(options);
	// A monitor is found by its series key: a monitor set's lines are its loaded monitors.
	const at =
		saved?.kind === "monitor"
			? places.findIndex((p) => p.place === `monitor:${saved.id}`)
			: saved
				? picks.findIndex((p) => sameRef(p, saved))
				: -1;
	return (places[at] ?? places[0])?.place ?? "";
}

/**
 * The ref "Overlay for" saves for the line `place` at `index`: a monitor by its id, else the
 * pick at that index (a Where area).
 */
export function overlayRefOf(place: PlaceInfo, index: number, picks: Picks): Picks[number] | null {
	const id = monitorOf(place.place);
	return id ? { kind: "monitor", id } : (picks[index] ?? null);
}

/**
 * Whether every place's overlay is the same day by day (places in one forecast zone), so the
 * Chart can show it once with no "Overlay for" choice.
 */
export function sharedSource(series: Series[]): boolean {
	const [first, ...rest] = series;
	return rest.every(
		(s) =>
			s.points.length === first.points.length &&
			s.points.every((p, i) => {
				const q = first.points[i];
				return p.t === q.t && p.level === q.level && Object.is(p.mean, q.mean);
			})
	);
}
