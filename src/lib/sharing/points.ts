import type { Change } from "$lib/changes/types";
import { calendarInput } from "$lib/calendars/input";
import { isCalendarType } from "$lib/calendars/types";
import type { CatalogEntry } from "$lib/data/metadata";
import type { WidgetDataConfig } from "$lib/data/schema";
import type { QueryInput } from "$lib/data/types";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { getWidgetType } from "$lib/widgets/registry";
import { offersNow } from "$lib/widgets/time";
import { DEFAULT_LAYER } from "$lib/widgets/defaults";
import { mainLayer, nowInput, widgetInputs, widgetPlaceKind } from "$lib/widgets/shared/input";
import { barHasPoint, hasPoints, pointWidgets } from "./point-layers";

export { hasPoints };

/**
 * Location privacy when sharing: an exact location (a `point` in any widget's Where) leaves the
 * owner's browser as the region its widget shows now, unless the owner chooses otherwise. The
 * Change place bar's point goes with them: it becomes the region of a widget at the same point,
 * or is dropped when none is.
 * `$lib/data` is reached with a dynamic import, and only for a dashboard that has a point.
 */

/** How long looking up the points' regions may take before it counts as failed. */
const LOOKUP_TIMEOUT_MS = 20_000;

/**
 * A point widget's region, or `null` when it has none (the place is cleared). `point` is the
 * point it was looked up for (in memory only): a swap applies only while the widget is still at it.
 */
export type PointSwap = {
	widgetId: string;
	point: { lat: number; lon: number };
	region: { type: string; code: string } | null;
};

/** Whether `place` is the point `swap` was looked up for. */
function samePoint(place: WidgetDataConfig["place"], swap: PointSwap): boolean {
	return place?.kind === "point" && place.lat === swap.point.lat && place.lon === swap.point.lon;
}

/** How a share's notice names where its points went. */
export type SwapSummary =
	{ kind: "one"; region: string } | { kind: "several" } | { kind: "removed" };

/** `signal`, also aborted after `LOOKUP_TIMEOUT_MS`; call `done` when finished with it. */
function bounded(signal?: AbortSignal): { signal: AbortSignal; done(): void } {
	const timed = new AbortController();
	const stop = () => timed.abort(signal?.reason);
	signal?.addEventListener("abort", stop, { once: true });
	if (signal?.aborted) stop();
	const timer = setTimeout(() => timed.abort(), LOOKUP_TIMEOUT_MS);
	return {
		signal: timed.signal,
		done() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", stop);
		}
	};
}

/**
 * Whether `swaps` covers every point `doc` holds now (same widget and point): false when one was
 * added or re-picked since the lookup, so the lookup has to run again. The bar's point needs no
 * lookup of its own (it takes its widget's region, or is dropped).
 */
export function pointsCovered(doc: Dashboard, swaps: PointSwap[]): boolean {
	return pointWidgets(doc).every(({ widget, point }) =>
		swaps.some((s) => s.widgetId === widget.id && samePoint(point, s))
	);
}

/**
 * The query a point widget's region is looked up with: the widget's own, for its main layer alone
 * (a point is a single place). A widget with no main layer (a Forecast strip's forecasts layer has
 * no entry type) is looked up as a PM2.5 one at the same place, as the place picker does; a "now"
 * widget over the trailing hours its tile reads, so the region matches what it shows. The
 * resolution comes from the dataset rules (with `catalog`) for that layer alone, not the widget's
 * whole dataset, so a widget whose other layers move its resolution may read another level.
 */
function lookupInput(
	widget: WidgetInstance,
	catalog: CatalogEntry[] | undefined
): QueryInput | null {
	const layer = mainLayer(widget.data, undefined) ?? DEFAULT_LAYER;
	const data = { ...widget.data, layers: [layer] };
	if (isCalendarType(widget.type)) return calendarInput(data, undefined, widget.type);
	// A Map is looked up as it frames its places now, whether or not it has a range.
	const type = getWidgetType(widget.type);
	if (type && offersNow(type)) return nowInput(data, layer);
	return widgetInputs({ type: widget.type, data }, catalog, widgetPlaceKind(data), 1).main;
}

/**
 * Each point widget's region (via `placeRegion`: the widget's own query, so the region it shows
 * now); rejects when a lookup fails, `signal` aborts, or 20 seconds pass.
 */
export async function pointSwaps(doc: Dashboard, signal?: AbortSignal): Promise<PointSwap[]> {
	const found = pointWidgets(doc);
	if (found.length === 0) return [];
	const { getMetadata, placeRegion } = await import("$lib/data");
	const { untilAborted } = await import("$lib/data/metadata");
	const timed = bounded(signal);
	try {
		timed.signal.throwIfAborted();
		const listed = await untilAborted(getMetadata().catalog(), timed.signal);
		const catalog = listed === "unavailable" ? undefined : listed;
		return await Promise.all(
			found.map(async ({ widget, point }): Promise<PointSwap> => {
				const input = lookupInput(widget, catalog);
				const region = input ? await placeRegion(input, timed.signal) : null;
				return { widgetId: widget.id, point: { lat: point.lat, lon: point.lon }, region };
			})
		);
	} finally {
		timed.done();
	}
}

/**
 * The bar's place once `swaps` are applied: the region of a swapped widget at its point (so
 * the bar still matches its widgets), else none. `applied` are the swaps that applied.
 */
function swappedBar(
	bar: Dashboard["body"]["placeBar"],
	applied: PointSwap[]
): Dashboard["body"]["placeBar"] {
	// Read defensively, as `pointWidgets` (a read-only document is unvalidated).
	if (bar?.place?.kind !== "point") return bar;
	const region = applied.find((s) => s.region && samePoint(bar.place, s))?.region;
	return region ? { place: { kind: "region", ...region } } : undefined;
}

/**
 * A copy of `doc` with each point replaced by its region, or the place cleared when `region` is
 * null; the bar's point becomes the same region as a widget at it, or is dropped.
 */
export function withSwaps(doc: Dashboard, swaps: PointSwap[]): Dashboard {
	if (swaps.length === 0 && !barHasPoint(doc)) return doc;
	const applied: PointSwap[] = [];
	const byWidget = new Map(swaps.map((s) => [s.widgetId, s]));
	const widgets = doc.body.widgets.map((widget) => {
		const swap = widget && byWidget.get(widget.id);
		// Only a widget still at the point looked up (it may have changed since).
		if (!swap || !samePoint(widget.data.place, swap)) return widget;
		applied.push(swap);
		const { region } = swap;
		// eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped from the copy
		const { place, ...rest } = widget.data;
		return {
			...widget,
			data: region ? { ...rest, place: { kind: "region" as const, ...region } } : rest
		};
	});
	const { placeBar, ...body } = doc.body;
	const bar = swappedBar(placeBar, applied);
	return { ...doc, body: { ...body, widgets, ...(bar ? { placeBar: bar } : {}) } };
}

/**
 * `withSwaps` as one change to `doc`: `setWidgetData` when one widget has points and the bar
 * holds none (so edits elsewhere, from this or another device, aren't touched), else one
 * `replaceDocument` (no other single change covers several widgets, or the bar). `null` when
 * nothing would change.
 */
export function swapChange(doc: Dashboard, swaps: PointSwap[]): Change | null {
	const next = withSwaps(doc, swaps);
	const changed = next.body.widgets.filter((w, i) => w !== doc.body.widgets[i]);
	const barMoved = next.body.placeBar !== doc.body.placeBar;
	if (changed.length === 1 && !barMoved) {
		const widget = changed[0];
		return {
			op: "setWidgetData",
			target: { widgetId: widget.id },
			from: doc.body.widgets.find((w) => w.id === widget.id)!.data,
			to: widget.data
		};
	}
	if (changed.length > 1 || barMoved) {
		return {
			op: "replaceDocument",
			target: {},
			from: { name: doc.name, body: doc.body },
			to: { name: doc.name, body: next.body }
		};
	}
	return null;
}

/**
 * What the notice says: one region by name ("ZIP 93721"), several (different regions, or some
 * points left out), or every point left out (outside every region).
 */
export async function summarizeSwaps(
	swaps: PointSwap[],
	signal?: AbortSignal
): Promise<SwapSummary> {
	const regions = swaps.map((s) => s.region);
	if (regions.every((r) => r === null)) return { kind: "removed" };
	const first = regions[0];
	if (!first || regions.some((r) => r?.type !== first.type || r.code !== first.code)) {
		return { kind: "several" };
	}
	const [{ getResolvers }, { regionName }] = await Promise.all([
		import("$lib/data"),
		import("$lib/places/region-name")
	]);
	// A name that can't be found in time is shown as its code.
	const timed = bounded(signal);
	try {
		return { kind: "one", region: await regionName(getResolvers().regions, first, timed.signal) };
	} finally {
		timed.done();
	}
}

/** "Your location is shared as ZIP 93721, not your exact position.", and the like. */
export function swapNotice(summary: SwapSummary): string {
	switch (summary.kind) {
		case "one":
			return m.share_points_notice({ region: summary.region });
		case "several":
			return m.share_points_notice_several();
		case "removed":
			return m.share_points_notice_removed();
	}
}
