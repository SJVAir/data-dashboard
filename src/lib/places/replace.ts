import type { Change } from "$lib/changes/types";
import type { ChosenPlace, Layer } from "$lib/data/schema";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { readingOrder } from "$lib/layout/engine";
import { sameRef } from "./types";

/**
 * The one place all of a widget's place-bearing layers share; `"mixed"` for a selection, layers
 * at different places, or a place-tied choice (a weather layer's chosen `station`; the layer
 * schema has no other place-tied field: pesticide `filters` are not tied to a place); `null`
 * when no layer has a place (a Note). The starter-only `default-place` counts as mixed, so it
 * is never rewritten.
 */
export function widgetPlace(widget: WidgetInstance): ChosenPlace | "mixed" | null {
	let found: ChosenPlace | null = null;
	for (const layer of widget.data.layers) {
		if (layer.selection || layer.station) return "mixed";
		const place = layer.place;
		if (!place) continue;
		if (place.kind === "default-place") return "mixed";
		if (found && !sameRef(found, place)) return "mixed";
		found = place;
	}
	return found;
}

function single(widget: WidgetInstance): ChosenPlace | null {
	const place = widgetPlace(widget);
	return place === "mixed" ? null : place;
}

function moved(widget: WidgetInstance, to: ChosenPlace): WidgetInstance {
	const layers: Layer[] = widget.data.layers.map((l) => (l.place ? { ...l, place: to } : l));
	return { ...widget, data: { ...widget.data, layers } };
}

/**
 * Widgets at `from` (and, with `others`, every single-place widget) switch to `to`. Mixed
 * widgets and Notes never change, nor do widgets already at `to`. The bar moves when it is at
 * `from`. `doc` itself when nothing moves (`from` is `to` without `others`), so it gives no
 * change; with `others`, picking the bar's own place brings the other widgets to it.
 */
export function replacePlace(
	doc: Dashboard,
	from: ChosenPlace,
	to: ChosenPlace,
	opts: { others: boolean }
): Dashboard {
	if (sameRef(from, to) && !opts.others) return doc;
	const widgets = doc.body.widgets.map((w) => {
		const place = single(w);
		if (!place || sameRef(place, to)) return w;
		return sameRef(place, from) || opts.others ? moved(w, to) : w;
	});
	const bar = doc.body.placeBar;
	const placeBar = bar && sameRef(bar.place, from) && !sameRef(bar.place, to) ? { place: to } : bar;
	return { ...doc, body: { ...doc.body, widgets, ...(placeBar ? { placeBar } : {}) } };
}

/** Single-place widgets at a place other than `place`. */
export function othersCount(doc: Dashboard, place: ChosenPlace): number {
	return doc.body.widgets.filter((w) => {
		const p = single(w);
		return p !== null && !sameRef(p, place);
	}).length;
}

/** The bar is set and at least one widget shows its place. */
export function barVisible(doc: Dashboard): boolean {
	const bar = doc.body.placeBar;
	return (
		!!bar &&
		doc.body.widgets.some((w) => {
			const p = single(w);
			return p !== null && sameRef(p, bar.place);
		})
	);
}

/** The most common single places, all of a tie (first seen in reading order); empty if none. */
export function mainPlaces(doc: Dashboard): ChosenPlace[] {
	const counts: { place: ChosenPlace; n: number }[] = [];
	for (const w of readingOrder(doc.body.widgets)) {
		const place = single(w);
		if (!place) continue;
		const entry = counts.find((c) => sameRef(c.place, place));
		if (entry) entry.n++;
		else counts.push({ place, n: 1 });
	}
	const top = Math.max(0, ...counts.map((c) => c.n));
	return counts.filter((c) => c.n === top).map((c) => c.place);
}

/**
 * `next` as one change to `doc`: `setWidgetData` when one widget changed and the bar didn't
 * move, else one `replaceDocument`; `null` when nothing changed. Widgets are compared by index,
 * so `next` must keep `doc`'s widgets in the same order, one for one (as `replacePlace` does:
 * it maps each widget and keeps the unchanged ones as the same objects).
 */
export function replaceChange(doc: Dashboard, next: Dashboard): Change | null {
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
	if (changed.length > 0 || barMoved) {
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
 * The bar's "Change place" as one change: the widgets at the bar's place (and, with `others`,
 * the other single-place widgets) and the bar switch to `to`. `null` with no bar, or no change.
 */
export function barChange(
	doc: Dashboard,
	to: ChosenPlace,
	opts: { others: boolean }
): Change | null {
	const bar = doc.body.placeBar;
	if (!bar) return null;
	return replaceChange(doc, replacePlace(doc, bar.place, to, opts));
}
