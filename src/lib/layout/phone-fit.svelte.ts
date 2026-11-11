import { SvelteMap } from "svelte/reactivity";

/** The tallest (in rows) a Note grows to fit its text on a phone; a longer one scrolls inside. */
export const PHONE_FIT_MAX_ROWS = 12;

/** Context key for the grid's `PhoneFit`. */
export const PHONE_FIT_KEY = Symbol("phone-fit");

/**
 * The rows a box of `height` px needs on a grid of `rowHeight` px rows with `gap` px between
 * them (a span of n rows is n × rowHeight + (n − 1) × gap). A sliver over a whole row (subpixel
 * rounding) doesn't take another.
 */
export function rowsFor(height: number, rowHeight: number, gap: number): number {
	const pitch = rowHeight + gap;
	if (!(pitch > 0) || !(height > 0)) return 1;
	return Math.max(1, Math.ceil((height + gap) / pitch - 0.01));
}

/**
 * On a phone, the rows each widget's content asks for (only a Note asks: it grows to fit its
 * text), so the one-column layout gives it that many, up to `PHONE_FIT_MAX_ROWS`, and never fewer
 * than its own height. Display only: the stored rect never changes.
 */
export class PhoneFit {
	#rows = new SvelteMap<string, number>();
	/** Bumped on every change, so the grid can tell a fit from an arrangement (it doesn't animate). */
	version = $state(0);

	/** The rows `id`'s content needs now, or `null` when it asks for none (it's gone). */
	report(id: string, rows: number | null): void {
		if (rows === null ? !this.#rows.has(id) : this.#rows.get(id) === rows) return;
		if (rows === null) this.#rows.delete(id);
		else this.#rows.set(id, rows);
		this.version++;
	}

	/** `id`'s row span on a phone, for its own height `h`. */
	span(id: string, h: number): number {
		const rows = this.#rows.get(id);
		return rows === undefined ? h : Math.max(h, Math.min(rows, PHONE_FIT_MAX_ROWS));
	}
}
