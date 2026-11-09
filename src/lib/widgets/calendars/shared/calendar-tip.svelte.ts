import { getContext, setContext } from "svelte";

/** The day a calendar's tooltip points at: its text and its cell. */
export type CalendarTipTarget = { text: string; cell: HTMLElement };

/** One tooltip per calendar: the grid says which day; the shell draws it. */
export class CalendarTip {
	current = $state.raw<CalendarTipTarget | null>(null);

	show(target: CalendarTipTarget): void {
		if (this.current?.text !== target.text || this.current.cell !== target.cell) {
			this.current = target;
		}
	}

	/** Places it again, its cell having moved (a scroll). */
	reposition(): void {
		if (this.current) this.current = { ...this.current };
	}

	hide(): void {
		this.current = null;
	}
}

const KEY = Symbol("calendar-tip");

export function provideCalendarTip(): CalendarTip {
	return setContext(KEY, new CalendarTip());
}

/** The calendar's tooltip, if the grid sits in a calendar shell. */
export function useCalendarTip(): CalendarTip | undefined {
	return getContext<CalendarTip | undefined>(KEY);
}
