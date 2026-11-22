import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import type { PointPlace } from "$lib/places/types";

/**
 * Finding exact locations (a `point` in a widget's Where or the Change place bar). Kept apart
 * from `points.ts` (the region lookups) and free of imports, so the app and the sync upload can
 * check a dashboard without loading the lookups.
 */

/** A widget whose Where is a point (`PointPlace`, the places' own type). */
export type PointWidget = { widget: WidgetInstance; point: PointPlace };

/**
 * Every widget whose Where is a point. Read defensively: a read-only (newer or invalid) document
 * is the stored value unvalidated, so its shape isn't guaranteed.
 */
export function pointWidgets(doc: Dashboard): PointWidget[] {
	const widgets: unknown = doc.body?.widgets;
	if (!Array.isArray(widgets)) return [];
	const found: PointWidget[] = [];
	for (const widget of widgets as WidgetInstance[]) {
		const place: unknown = widget?.data?.place;
		if ((place as { kind?: unknown } | null)?.kind === "point") {
			found.push({ widget, point: place as PointPlace });
		}
	}
	return found;
}

/** Whether the Change place bar's place is a point (read defensively, as `pointWidgets`). */
export function barHasPoint(doc: Dashboard): boolean {
	const bar: unknown = doc.body?.placeBar;
	return (bar as { place?: { kind?: unknown } } | null)?.place?.kind === "point";
}

/** Whether `doc` holds an exact location anywhere: a widget's Where, or the bar. */
export function hasPoints(doc: Dashboard): boolean {
	return barHasPoint(doc) || pointWidgets(doc).length > 0;
}
