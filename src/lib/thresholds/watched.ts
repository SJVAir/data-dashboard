import type { WidgetInstance } from "$lib/documents/schema";
import { getWidgetType } from "$lib/widgets/registry";
import { showsNow } from "$lib/widgets/time";

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
