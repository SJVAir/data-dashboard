import type { Change } from "$lib/changes/types";
import { calendarInput } from "$lib/calendars/input";
import { isCalendarType } from "$lib/calendars/types";
import type { Layer } from "$lib/data/schema";
import type { QueryInput } from "$lib/data/types";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { getWidgetType } from "$lib/widgets/registry";
import { chartInput, nowInput, placesLayer, placesQueryLayer } from "$lib/widgets/shared/input";
import { barHasPoint, hasPoints, pointLayers } from "./point-layers";

export { hasPoints };

/**
 * Location privacy when sharing: an exact location (a `point` place in any widget layer) leaves
 * the owner's browser as the region its widget shows now, unless the owner chooses otherwise. The
 * Change place bar's point goes with them: it becomes the region of a layer holding the same
 * point, or is dropped when none does.
 * `$lib/data` is reached with a dynamic import, and only for a dashboard that has a point.
 */

/** How long looking up the points' regions may take before it counts as failed. */
const LOOKUP_TIMEOUT_MS = 20_000;

/**
 * A point layer's region, or `null` when it has none (the place is cleared). `point` is the
 * point it was looked up for (in memory only): a swap applies only while the layer still holds it.
 */
export type PointSwap = {
	widgetId: string;
	layerIndex: number;
	point: { lat: number; lon: number };
	region: { type: string; code: string } | null;
};

/** Whether `place` is the point `swap` was looked up for. */
function samePoint(place: Layer["place"], swap: PointSwap): boolean {
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
 * Whether `swaps` covers every point `doc` holds now (same widget, layer, and point): false when
 * one was added, re-picked, or moved since the lookup, so the lookup has to run again. The bar's
 * point needs no lookup of its own (it takes its layer's region, or is dropped).
 */
export function pointsCovered(doc: Dashboard, swaps: PointSwap[]): boolean {
	return pointLayers(doc).every(({ widget, layer, layerIndex }) =>
		swaps.some(
			(s) => s.widgetId === widget.id && s.layerIndex === layerIndex && samePoint(layer.place, s)
		)
	);
}

/**
 * The query a point layer's region is looked up with: the widget's own, for this layer alone (a
 * point is a single place). A Forecast strip's layer (no entry type) is looked up as a PM2.5 one at
 * the same place, as the place picker does; a "now" widget over the trailing hours its tile reads,
 * so the region matches what it shows. Null when the layer isn't the widget's places layer.
 */
function lookupInput(widget: WidgetInstance, layer: Layer): QueryInput | null {
	const data = { ...widget.data, layers: [layer] };
	const places = placesLayer(data, undefined);
	if (!places) return null;
	const query = placesQueryLayer(places);
	if (isCalendarType(widget.type))
		return calendarInput({ ...data, layers: [query] }, undefined, widget.type);
	if (getWidgetType(widget.type)?.time === "now") return nowInput(query);
	return chartInput({ ...data, layers: [query] }, undefined, 1).input;
}

/**
 * Each point layer's region (via `placeRegion`: the widget's own query, so the region it shows
 * now); rejects when a lookup fails, `signal` aborts, or 20 seconds pass. A point layer that
 * isn't its widget's places layer shows nothing, so it has no region.
 */
export async function pointSwaps(doc: Dashboard, signal?: AbortSignal): Promise<PointSwap[]> {
	const found = pointLayers(doc);
	if (found.length === 0) return [];
	const { placeRegion } = await import("$lib/data");
	const timed = bounded(signal);
	try {
		timed.signal.throwIfAborted();
		return await Promise.all(
			found.map(async ({ widget, layer, layerIndex }): Promise<PointSwap> => {
				const input = lookupInput(widget, layer);
				const region = input ? await placeRegion(input, timed.signal) : null;
				const { lat, lon } = layer.place as Extract<Layer["place"], { kind: "point" }>;
				return { widgetId: widget.id, layerIndex, point: { lat, lon }, region };
			})
		);
	} finally {
		timed.done();
	}
}

/**
 * The bar's place once `swaps` are applied: the region of a swapped layer holding its point (so
 * the bar still matches its widgets), else none. `applied` are the swaps that applied.
 */
function swappedBar(
	bar: Dashboard["body"]["placeBar"],
	applied: PointSwap[]
): Dashboard["body"]["placeBar"] {
	// Read defensively, as `pointLayers` (a read-only document is unvalidated).
	if (bar?.place?.kind !== "point") return bar;
	const region = applied.find((s) => s.region && samePoint(bar.place, s))?.region;
	return region ? { place: { kind: "region", ...region } } : undefined;
}

/**
 * A copy of `doc` with each point replaced by its region, or the place cleared when `region` is
 * null; the bar's point becomes the same region as a layer holding it, or is dropped.
 */
export function withSwaps(doc: Dashboard, swaps: PointSwap[]): Dashboard {
	if (swaps.length === 0 && !barHasPoint(doc)) return doc;
	const applied: PointSwap[] = [];
	const byWidget = new Map<string, Map<number, PointSwap>>();
	for (const swap of swaps) {
		const layers = byWidget.get(swap.widgetId) ?? new Map<number, PointSwap>();
		layers.set(swap.layerIndex, swap);
		byWidget.set(swap.widgetId, layers);
	}
	const widgets = doc.body.widgets.map((widget) => {
		const regions = widget && byWidget.get(widget.id);
		if (!regions) return widget;
		return {
			...widget,
			data: {
				...widget.data,
				layers: widget.data.layers.map((layer, i) => {
					// Only a layer still holding the point looked up (it may have changed since).
					const swap = regions.get(i);
					if (!swap || !samePoint(layer.place, swap)) return layer;
					applied.push(swap);
					const { region } = swap;
					// eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped from the copy
					const { place, ...rest } = layer;
					return region ? { ...rest, place: { kind: "region" as const, ...region } } : rest;
				})
			}
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
