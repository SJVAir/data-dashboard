import { visibleSelection } from "$lib/calendars/selection";
import { setShownSelection } from "$lib/calendars/shown-registry";
import type { WidgetInstance } from "$lib/documents/schema";
import type { AppContext } from "$lib/store/app.svelte";
import type { CalendarData } from "./calendar-data.svelte";
import { canWriteSelection, writeSelection, type DaySpan } from "./write-selection";

/**
 * A calendar's selected days: saved with the dashboard when it can be; else (shared and
 * read-only views, Get data's preview) kept here, in memory. Plus the drag in progress. Call
 * during component initialization.
 */
export class CalendarSelection {
	readonly #app: AppContext;
	readonly #widget: () => WidgetInstance;
	readonly #data: CalendarData;
	#local = $state.raw<DaySpan | null | undefined>(undefined);

	/** A pointer drag is extending the selection (not yet saved). */
	dragging = $state(false);
	/** The selection a drag in progress would make. */
	preview = $state.raw<DaySpan | null>(null);

	readonly writable = $derived.by(() => canWriteSelection(this.#app, this.#widget().id));
	readonly #stored = $derived.by(() => {
		const s = this.#data.selectable;
		return s ? visibleSelection(this.#widget().data.timeSubRange, s, s.last) : null;
	});
	/** The selected days shown (limited to the range). */
	readonly selection = $derived.by(() => {
		const local = this.#local;
		if (this.writable || local === undefined) return this.#stored;
		const s = this.#data.selectable;
		return local && s ? visibleSelection(local, s, s.last) : null;
	});
	/** What the summary shows: the drag's span while one is in progress. */
	readonly shown = $derived(this.preview ?? this.selection);

	constructor(app: AppContext, widget: () => WidgetInstance, data: CalendarData) {
		this.#app = app;
		this.#widget = widget;
		this.#data = data;
		// The menu's "Open these days in a chart" is offered while saved days are shown.
		const owner = Symbol("calendar");
		$effect(() => {
			const sel = this.writable ? this.selection : null;
			return setShownSelection(this.#widget().id, owner, sel);
		});
	}

	/** A finished gesture's selection. */
	select = (sel: DaySpan | null): void => {
		if (this.writable) writeSelection(this.#app, this.#widget(), sel);
		else this.#local = sel;
	};
}
