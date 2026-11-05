import type { Layer } from "$lib/data/schema";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";

/**
 * Finding exact locations (a `point` place in a widget layer). Kept apart from `points.ts` (the
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

export function hasPoints(doc: Dashboard): boolean {
	return pointLayers(doc).length > 0;
}
