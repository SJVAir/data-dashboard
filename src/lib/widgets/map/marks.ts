import type { SpatialSelection } from "@sjvair/map-sdk/data";
import type { Change } from "$lib/changes/types";
import type { WidgetInstance } from "$lib/documents/schema";
import { MAP_MARKS_MAX, mapOptions } from "./options";

/** map-sdk's canSelect: true, or the limit message when `next` holds more than 25. */
export function canMark(next: SpatialSelection | null, limitMessage: string): true | string {
	return (next?.ids.length ?? 0) <= MAP_MARKS_MAX || limitMessage;
}

/** Marks not drawn now (outside the places or not reporting the pollutant showing). */
export function hiddenMarks(marks: readonly string[], drawn: ReadonlySet<string>): string[] {
	return marks.filter((id) => !drawn.has(id));
}

/** Whether two id lists hold the same ids in the same order. */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** The setWidgetData change that saves `marks`, or null when unchanged. */
export function marksChange(widget: WidgetInstance, marks: string[]): Change | null {
	const current = mapOptions(widget).marks ?? [];
	if (sameIds(current, marks)) return null;
	// The other options stay as they are; no marks leaves no `marks` key.
	const rest: Record<string, unknown> = { ...widget.options };
	delete rest.marks;
	return {
		op: "setWidgetData",
		target: { widgetId: widget.id },
		from: widget.data,
		to: widget.data,
		options: { from: widget.options, to: marks.length ? { ...rest, marks: [...marks] } : rest }
	};
}

/** Why a marked monitor isn't drawn. */
export type HiddenReason = "pollutant" | "options" | "places" | "unknown";

/** The reasons in the order their lines are shown. */
export const HIDDEN_REASON_ORDER: readonly HiddenReason[] = [
	"pollutant",
	"options",
	"places",
	"unknown"
];

/**
 * Counts the hidden marks by reason. A mark whose monitor the metadata doesn't list is
 * `unknown`; one whose type doesn't report the pollutant drawn is `pollutant`; one among the
 * loaded monitors (so in the places) that the toolbar's filters hide is `options`; the rest are
 * outside the places. `monitors` is null while the metadata is loading (or failed).
 */
export function hiddenReasons(
	hidden: readonly string[],
	monitors: ReadonlyMap<string, { type: string }> | null,
	reports: (type: string) => boolean | undefined,
	loadedIds: ReadonlySet<string>
): Map<HiddenReason, number> {
	const counts = new Map<HiddenReason, number>();
	for (const id of hidden) {
		const monitor = monitors?.get(id);
		const reason: HiddenReason = !monitor
			? "unknown"
			: reports(monitor.type) === false
				? "pollutant"
				: loadedIds.has(id)
					? "options"
					: "places";
		counts.set(reason, (counts.get(reason) ?? 0) + 1);
	}
	return counts;
}
