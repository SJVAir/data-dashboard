// Lazy code only (the chart opener): the menu item reads `shown-registry` instead.
import type { WidgetInstance } from "$lib/documents/schema";
import { todayPacific } from "$lib/format";
import { resolveRange } from "$lib/format/range";
import { DEFAULT_RANGE } from "$lib/widgets/defaults";
import { visibleSelection } from "./selection";
import { CALENDAR_DEFAULT_RANGES } from "./input";

/**
 * The part of a calendar's saved selection it shows now: inside its range as of `now`, and no
 * later than today. `null` when none of it is (a rolling range moved on, say).
 */
export function shownSelection(
	widget: WidgetInstance,
	now: Date = new Date()
): { start: string; end: string } | null {
	const spec = widget.data.dateRange ?? CALENDAR_DEFAULT_RANGES[widget.type] ?? DEFAULT_RANGE;
	const range = resolveRange(spec, now);
	const today = todayPacific(now);
	const last = range.lastDate < today ? range.lastDate : today;
	if (range.firstDate > last) return null;
	return visibleSelection(widget.data.timeSubRange, { first: range.firstDate, last }, last);
}
