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
export type HiddenReason = "pollutant" | "period" | "options" | "places" | "unknown";

/** The reasons in the order their lines are shown. */
export const HIDDEN_REASON_ORDER: readonly HiddenReason[] = [
	"pollutant",
	"period",
	"options",
	"places",
	"unknown"
];

/**
 * Counts the hidden marks by reason. A mark whose monitor the metadata doesn't list is
 * `unknown`; one whose type doesn't report the pollutant drawn is `pollutant`; one among the
 * loaded monitors (so in the places) is `period` when a stop shows (`dayDrawn`: the monitors with
 * a figure for the stop's period) and it has none for it, else `options` (the toolbar's filters hide it); the
 * rest are outside the places. `monitors` is null while the metadata is loading (or failed). The
 * tile's own monitors (its places) are never filtered, so never `options`.
 */
export function hiddenReasons(
	hidden: readonly string[],
	monitors: ReadonlyMap<string, { type: string }> | null,
	reports: (type: string) => boolean | undefined,
	loadedIds: ReadonlySet<string>,
	dayDrawn?: ReadonlySet<string>
): Map<HiddenReason, number> {
	const counts = new Map<HiddenReason, number>();
	for (const id of hidden) {
		const monitor = monitors?.get(id);
		const inPlaces = loadedIds.has(id);
		const reason: HiddenReason = !monitor
			? "unknown"
			: reports(monitor.type) === false
				? "pollutant"
				: inPlaces && dayDrawn && !dayDrawn.has(id)
					? "period"
					: inPlaces
						? "options"
						: "places";
		counts.set(reason, (counts.get(reason) ?? 0) + 1);
	}
	return counts;
}

/**
 * The reasons to show, in order, with their counts. Without a pollutant label a "pollutant"
 * reason can't be worded, so its marks count as `unknown` ("aren't shown").
 */
export function hiddenReasonLines(
	reasons: ReadonlyMap<HiddenReason, number>,
	label: string | undefined
): Array<{ reason: HiddenReason; count: number }> {
	const counts = new Map(reasons);
	if (!label && counts.has("pollutant")) {
		counts.set("unknown", (counts.get("unknown") ?? 0) + counts.get("pollutant")!);
		counts.delete("pollutant");
	}
	return HIDDEN_REASON_ORDER.filter((r) => counts.has(r)).map((reason) => ({
		reason,
		count: counts.get(reason)!
	}));
}
