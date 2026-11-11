import type { Layer } from "$lib/data/schema";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";

/**
 * Finding exact locations (a `point` place in a widget layer or the Change place bar). Kept apart from `points.ts` (the
 * region lookups) and free of imports, so the app and the sync upload can check a dashboard
 * without loading the lookups.
 */

export type PointLayer = { widget: WidgetInstance; layer: Layer; layerIndex: number };

/**
 * Every point layer. Read defensively: a read-only (newer or invalid) document is the stored
 * value unvalidated, so its shape isn't guaranteed.
 */
export function pointLayers(doc: Dashboard): PointLayer[] {
	const widgets: unknown = doc.body?.widgets;
	if (!Array.isArray(widgets)) return [];
	const found: PointLayer[] = [];
	for (const widget of widgets as WidgetInstance[]) {
		const layers: unknown = widget?.data?.layers;
		if (!Array.isArray(layers)) continue;
		(layers as Layer[]).forEach((layer, layerIndex) => {
			if (layer?.place?.kind === "point") found.push({ widget, layer, layerIndex });
		});
	}
	return found;
}

/** Whether the Change place bar's place is a point (read defensively, as `pointLayers`). */
export function barHasPoint(doc: Dashboard): boolean {
	const bar: unknown = doc.body?.placeBar;
	return (bar as { place?: { kind?: unknown } } | null)?.place?.kind === "point";
}

/** Whether `doc` holds an exact location anywhere: a point layer, or the bar. */
export function hasPoints(doc: Dashboard): boolean {
	return barHasPoint(doc) || pointLayers(doc).length > 0;
}
