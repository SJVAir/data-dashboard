import type { WidgetInstance } from "$lib/documents/schema";
import { getWidgetType } from "$lib/widgets/registry";

/**
 * Whether the dashboard's threshold watcher watches `widget`: a "now" type that takes thresholds
 * (Charts' threshold lines are display only) with one saved.
 */
export function watchesThresholds(widget: WidgetInstance): boolean {
	const type = getWidgetType(widget.type);
	return type?.time === "now" && type.thresholds && (widget.thresholds?.length ?? 0) > 0;
}
