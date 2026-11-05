import type { Layer } from "$lib/data/schema";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { chartInput } from "$lib/widgets/shared/input";

/**
 * Location privacy when sharing: an exact location (a `point` place in any widget layer) leaves
 * the owner's browser as the region its widget shows now, unless the owner chooses otherwise.
 * `$lib/data` is reached with a dynamic import, and only for a dashboard that has a point.
 */

/** How long looking up the points' regions may take before it counts as failed. */
const LOOKUP_TIMEOUT_MS = 20_000;

/** A point layer's region, or `null` when it has none (the place is cleared). */
export type PointSwap = {
	widgetId: string;
	layerIndex: number;
	region: { type: string; code: string } | null;
};

/** How a share's notice names where its points went. */
export type SwapSummary =
	{ kind: "one"; region: string } | { kind: "several" } | { kind: "removed" };

type Found = { widget: WidgetInstance; layer: Layer; layerIndex: number };

/**
 * Every point layer. Read defensively: a read-only (newer or invalid) document is the stored
 * value unvalidated, so its shape isn't guaranteed.
 */
function pointLayers(doc: Dashboard): Found[] {
	const widgets: unknown = doc.body?.widgets;
	if (!Array.isArray(widgets)) return [];
	const found: Found[] = [];
	for (const widget of widgets as WidgetInstance[]) {
		const layers: unknown = widget?.data?.layers;
		if (!Array.isArray(layers)) continue;
		(layers as Layer[]).forEach((layer, layerIndex) => {
			if (layer?.place?.kind === "point") found.push({ widget, layer, layerIndex });
		});
	}
	return found;
}

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

export function hasPoints(doc: Dashboard): boolean {
	return pointLayers(doc).length > 0;
}

/**
 * Each point layer's region (via `placeRegion`: the widget's own query, so the region it shows
 * now); rejects when a lookup fails, `signal` aborts, or 20 seconds pass. A point layer without
 * an entry type shows nothing, so it has no region.
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
				// The widget's query for this layer alone (a point is a single place).
				const { input } = chartInput({ ...widget.data, layers: [layer] }, undefined, 1);
				const region = input ? await placeRegion(input, timed.signal) : null;
				return { widgetId: widget.id, layerIndex, region };
			})
		);
	} finally {
		timed.done();
	}
}

/** A copy of `doc` with each point replaced by its region, or the place cleared when `region` is null. */
export function withSwaps(doc: Dashboard, swaps: PointSwap[]): Dashboard {
	if (swaps.length === 0) return doc;
	const byWidget = new Map<string, Map<number, PointSwap["region"]>>();
	for (const { widgetId, layerIndex, region } of swaps) {
		const layers = byWidget.get(widgetId) ?? new Map();
		layers.set(layerIndex, region);
		byWidget.set(widgetId, layers);
	}
	return {
		...doc,
		body: {
			...doc.body,
			widgets: doc.body.widgets.map((widget) => {
				const regions = widget && byWidget.get(widget.id);
				if (!regions) return widget;
				return {
					...widget,
					data: {
						...widget.data,
						layers: widget.data.layers.map((layer, i) => {
							// Only a layer that is still a point (it may have changed since the lookup).
							if (!regions.has(i) || layer.place?.kind !== "point") return layer;
							const region = regions.get(i);
							// eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped from the copy
							const { place, ...rest } = layer;
							return region ? { ...rest, place: { kind: "region" as const, ...region } } : rest;
						})
					}
				};
			})
		}
	};
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
