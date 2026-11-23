import type { WidgetInstance } from "$lib/documents/schema";
import { currentPollutants, onePollutant } from "$lib/widgets/current/pollutants";
import { CURRENT_TYPE } from "$lib/widgets/current/index";
import { getWidgetType } from "$lib/widgets/registry";
import { showsNow } from "$lib/widgets/time";
import { thresholdFor } from "./levels";
import { markKey } from "./marks.svelte";

/**
 * Whether the dashboard's threshold watcher watches `widget`: a widget showing now whose type
 * takes thresholds (Charts' threshold lines are display only) with one saved.
 */
export function watchesThresholds(widget: WidgetInstance): boolean {
	const type = getWidgetType(widget.type);
	return (
		!!type && showsNow(type, widget.data) && type.thresholds && (widget.thresholds?.length ?? 0) > 0
	);
}

/** The pollutants watched separately (Current conditions' with an alert level), in layer order. */
function watchedEntryTypes(widget: WidgetInstance): string[] | undefined {
	if (widget.type !== CURRENT_TYPE) return undefined;
	return currentPollutants(widget.data).filter((e) => thresholdFor(widget.thresholds, e));
}

/**
 * The keys (`markKey`) `widget` is watched under, in layer order: one per pollutant with an alert
 * level for Current conditions, its id for every other type. Marks, "last told" and the
 * notification tag are held under them.
 */
export function watchKeys(widget: WidgetInstance): string[] {
	const entryTypes = watchedEntryTypes(widget);
	return entryTypes ? entryTypes.map((e) => markKey(widget.id, e)) : [markKey(widget.id)];
}

/**
 * The watches `widget` takes, each a key and the widget as that watch reads it: Current
 * conditions showing only that pollutant (`onePollutant`), every other type as saved.
 */
export function watchesOf(widget: WidgetInstance): { key: string; widget: WidgetInstance }[] {
	const entryTypes = watchedEntryTypes(widget);
	if (!entryTypes) return [{ key: markKey(widget.id), widget }];
	return entryTypes.map((e) => ({ key: markKey(widget.id, e), widget: onePollutant(widget, e) }));
}
