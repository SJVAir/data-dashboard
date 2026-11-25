import type { Change } from "$lib/changes/types";
import type { ChosenPlace } from "$lib/data/schema";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { readingOrder } from "$lib/layout/engine";
import { CHART_TYPE } from "$lib/widgets/chart";
import { DATA_TABLE_TYPE } from "$lib/widgets/table";
import { sameRef } from "./types";

/** Whether a widget of `type` holds areas only in its Where (a Chart or Table, decision 2). */
export function areasOnly(type: string): boolean {
	return type === CHART_TYPE || type === DATA_TABLE_TYPE;
}

/** Whether `widget` can show `to`: a school or point never goes to an areas-only widget. */
function canShow(widget: WidgetInstance, to: ChosenPlace): boolean {
	return !(areasOnly(widget.type) && (to.kind === "location" || to.kind === "point"));
}

/**
 * A widget's one place (its Where); `"mixed"` for a selection or a place-tied choice (a weather
 * layer's chosen `station`; the layer schema has no other place-tied field: pesticide `filters`
 * are not tied to a place); `null` when it has no place (a Note, or everywhere). The
 * starter-only `default-place` counts as mixed, so it is never rewritten.
 */
export function widgetPlace(widget: WidgetInstance): ChosenPlace | "mixed" | null {
	const { place, selection, layers } = widget.data;
	if (selection || layers.some((l) => l.station)) return "mixed";
	if (!place) return null;
	return place.kind === "default-place" ? "mixed" : place;
}

function single(widget: WidgetInstance): ChosenPlace | null {
	const place = widgetPlace(widget);
	return place === "mixed" ? null : place;
}

function moved(widget: WidgetInstance, to: ChosenPlace): WidgetInstance {
	return { ...widget, data: { ...widget.data, place: to } };
}

/**
 * Widgets at `from` (and, with `others`, every single-place widget) switch to `to`. Mixed
 * widgets and Notes never change, nor do widgets already at `to`, nor a Chart or Table when `to`
 * is a school or point (they hold areas only and keep their own Where). The bar moves when it is at
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
		if (!place || sameRef(place, to) || !canShow(w, to)) return w;
		return sameRef(place, from) || opts.others ? moved(w, to) : w;
	});
	const bar = doc.body.placeBar;
	// A closed bar stays closed when it moves.
	const placeBar =
		bar && sameRef(bar.place, from) && !sameRef(bar.place, to) ? { ...bar, place: to } : bar;
	return { ...doc, body: { ...doc.body, widgets, ...(placeBar ? { placeBar } : {}) } };
}

/**
 * Single-place widgets at a place other than `place`; with `to`, only those `to` would change (a
 * school or point leaves Charts and Tables alone).
 */
export function othersCount(doc: Dashboard, place: ChosenPlace, to?: ChosenPlace): number {
	return doc.body.widgets.filter((w) => {
		const p = single(w);
		return p !== null && !sameRef(p, place) && (!to || (!sameRef(p, to) && canShow(w, to)));
	}).length;
}

/**
 * The bar is set and at least one widget shows its place, closed or not: the dashboard is about
 * that place ("Change place…", "Duplicate for another place", a new Map's place).
 */
export function barShowsPlace(doc: Dashboard): boolean {
	const bar = doc.body.placeBar;
	return (
		!!bar &&
		doc.body.widgets.some((w) => {
			const p = single(w);
			return p !== null && sameRef(p, bar.place);
		})
	);
}

/** The bar shows: it has a widget at its place and isn't closed. */
export function barVisible(doc: Dashboard): boolean {
	return barShowsPlace(doc) && !doc.body.placeBar?.closed;
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
 * Closes the bar for good on this dashboard (`closed`), or opens it again, as one undoable change;
 * `null` with no bar, or when it already is so.
 */
export function barClosedChange(doc: Dashboard, closed: boolean): Change | null {
	const bar = doc.body.placeBar;
	if (!bar || !!bar.closed === closed) return null;
	const placeBar = closed ? { ...bar, closed: true as const } : { place: bar.place };
	return {
		op: "replaceDocument",
		target: {},
		from: { name: doc.name, body: doc.body },
		to: { name: doc.name, body: { ...doc.body, placeBar } }
	};
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

/**
 * The places "Duplicate for another place" could replace: the bar's when a widget shows it, even
 * closed (that's what the dashboard is about), else the main place, all of a tie (in reading order); empty when no
 * widget shows a single place.
 */
export function placesToReplace(doc: Dashboard): ChosenPlace[] {
	const bar = doc.body.placeBar;
	return bar && barShowsPlace(doc) ? [bar.place] : mainPlaces(doc);
}
