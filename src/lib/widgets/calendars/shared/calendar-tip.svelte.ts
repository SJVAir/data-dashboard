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

	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- listeners, never read reactively
	#leave = new Set<() => void>();

	/** Runs `fn` when the pointer leaves the tooltip for somewhere off the grid; returns its undo. */
	onleave(fn: () => void): () => void {
		this.#leave.add(fn);
		return () => this.#leave.delete(fn);
	}

	/** The pointer left the tooltip for somewhere off the grid. */
	left(): void {
		for (const fn of this.#leave) fn();
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
