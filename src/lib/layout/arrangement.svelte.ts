import { getContext, untrack } from "svelte";
import type { Change } from "$lib/changes/types";
import type { Dashboard, Rect } from "$lib/documents/schema";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import { GRID_COLUMNS } from "./config";
import { move, moveInOrder, resize, type Layout, type LayoutItem, type Size } from "./engine";
import { layoutChange, shownLayout } from "./items";

export type ArrangeMode = "move" | "resize";
export type ArrangeInput = "pointer" | "keyboard" | "touch";
export type ArrangeDirection = "up" | "down" | "left" | "right";
export type StepResult = "moved" | "at-bottom" | "blocked";

type Active = { id: string; mode: ArrangeMode; input: ArrangeInput };
/**
 * One request for the active widget, applied to the layout before it: move to a desktop cell,
 * move to a reading-order index (phone), or resize in place. A cell or index request may carry
 * a size to take first.
 */
type Op =
	| { kind: "cell"; x: number; y: number; size: Size | null }
	| { kind: "order"; index: number; size: Size | null }
	| { kind: "size"; w: number; h: number };
/**
 * The requests since pickup, in order. Pointer and touch input replace the list with one
 * request against the document's layout; each keyboard step appends one against the preview
 * shown at the time, so every keypress moves one step from what the person sees.
 */
type Target = readonly Op[];

const NO_TARGET: Target = [];

/**
 * A focus request carried from a starter's page to its copy's: a drop on the starter hands off
 * to a copy, and the page then shows the copy with a new grid (and a new `Arrangement`).
 */
let carried: { from: DocumentSession; id: string } | null = null;

/** Layouts kept per document layout, by request prefix (a drag revisits cells; moveInOrder costs a few ms). */
const CACHE_LIMIT = 512;

export const ARRANGEMENT_KEY = Symbol("arrangement");

/** The dashboard page's arrangement controller, from context. */
export function useArrangement(): Arrangement {
	return getContext<Arrangement>(ARRANGEMENT_KEY);
}

function sizeKey(size: Size | null): string {
	return size ? `${size.w}x${size.h}` : "-";
}

function opKey(op: Op): string {
	if (op.kind === "cell") return `@${op.x},${op.y}:${sizeKey(op.size)}`;
	if (op.kind === "order") return `#${op.index}:${sizeKey(op.size)}`;
	return `=${op.w}x${op.h}`;
}

function targetKey(id: string, t: Target): string {
	return [id, ...t.map(opKey)].join("|");
}

function sameRect(a: Rect, b: Rect): boolean {
	return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function sameLayout(a: Layout, b: Layout): boolean {
	return (
		a.length === b.length &&
		a.every(
			(item, i) =>
				item.id === b[i].id &&
				sameRect(item.rect, b[i].rect) &&
				item.minSize.w === b[i].minSize.w &&
				item.minSize.h === b[i].minSize.h
		)
	);
}

function itemOf(layout: Layout, id: string): LayoutItem {
	return layout.find((i) => i.id === id)!;
}

/** The nearest widget below `id` that shares its columns (what moving down passes). */
function nextBelow(layout: Layout, id: string): LayoutItem | undefined {
	const { x, y, w } = itemOf(layout, id).rect;
	return layout.find(
		(i) => i.id !== id && i.rect.y > y && i.rect.x < x + w && x < i.rect.x + i.rect.w
	);
}

/**
 * An in-progress move or resize, shared by pointer, touch, and keyboard input. Nothing is
 * applied to the document until `drop`; meanwhile `preview` is the layout the drop would save.
 *
 * `preview` is always in desktop (12-column) coordinates and is recomputed from the current
 * document plus the active widget's target, so another tab's change mid-drag shows up in it,
 * and the drop's `from` is read from the document at drop time. `columns()` only picks the
 * phone behavior (1 column): Up/Down reorder, Shift+Up/Down change the height.
 *
 * If the active widget leaves the grid (deleted or minimized elsewhere), `active` and `preview`
 * read null at once; the state is cleared and `onGone(id)` is called once, by an effect in the
 * browser, or by the next input otherwise. Call `dispose` when the page goes away.
 */
export class Arrangement {
	#active = $state.raw<Active | null>(null);
	#target = $state.raw<Target>(NO_TARGET);
	/** The last size asked for (grow or resizeTo), kept by later pointer requests. */
	#size: Size | null = null;
	/**
	 * The widget whose title bar should take focus once mounted, set by every drop that applies
	 * a change (its title bar may remount, e.g. after a starter hand-off). The page focuses it,
	 * then sets this back to null. `pickUp` and `cancel` clear it.
	 */
	pendingFocus = $state<string | null>(null);
	/**
	 * A pickup asked for by the widget's Move… or Resize… item, once its menu has closed. The
	 * widget's frame focuses its title bar, then picks it up (by keyboard) and sets this to null.
	 */
	pickUpRequest = $state.raw<{ id: string; mode: ArrangeMode } | null>(null);

	readonly #session: () => DocumentSession | null;
	readonly #columns: () => number;
	readonly #onGone: ((id: string) => void) | undefined;
	readonly #stop: () => void;

	/** The shown layout of the last document seen (kept by reference while it's unchanged). */
	#base: { doc: Dashboard; layout: Layout } | null = null;
	/** Previews of `#cacheBase`, by target. */
	// A cache, not reactive state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#cache = new Map<string, Layout>();
	#cacheBase: Layout | null = null;

	#preview = $derived.by(() => this.#computePreview());

	constructor(
		session: () => DocumentSession | null,
		columns: () => number,
		opts: { onGone?: (id: string) => void } = {}
	) {
		this.#session = session;
		this.#columns = columns;
		this.#onGone = opts.onGone;
		// A new page for the copy a starter's drop handed off to: focus the moved widget there.
		const from = carried;
		carried = null;
		const now = untrack(session);
		if (from && now && now !== from.from && from.from.editTarget === now) {
			this.pendingFocus = from.id;
		}
		this.#stop = $effect.root(() => {
			$effect(() => this.#checkGone());
		});
	}

	get active(): Active | null {
		const active = this.#active;
		return active && this.#onGrid(active.id) ? active : null;
	}

	/** The page's columns now: 1 on a phone, else `GRID_COLUMNS`. */
	get columns(): number {
		return this.#columns();
	}

	get preview(): Layout | null {
		return this.#preview;
	}

	/** Widgets other than the active one whose previewed rect differs from the document's. */
	get pushedCount(): number {
		const preview = this.#preview;
		const doc = this.#doc();
		if (!preview || !doc) return 0;
		const base = this.#baseLayout(doc);
		const id = this.#active!.id;
		return preview.filter((item) => {
			if (item.id === id) return false;
			const before = base.find((b) => b.id === item.id);
			return !before || !sameRect(before.rect, item.rect);
		}).length;
	}

	pickUp(id: string, mode: ArrangeMode, input: ArrangeInput): void {
		this.#checkGone();
		if (!this.#onGrid(id)) return;
		this.#clear();
		this.pendingFocus = null;
		this.pickUpRequest = null;
		this.#active = { id, mode, input };
	}

	/** Ask the widget's frame to focus its title bar and pick it up by keyboard. */
	requestPickUp(id: string, mode: ArrangeMode): void {
		this.pickUpRequest = { id, mode };
	}

	/** Move the active widget to a cell (engine `move`; widgets in the way are pushed down). */
	moveTo(to: { x: number; y: number }): void {
		if (!this.#live()) return;
		this.#setTarget([{ kind: "cell", x: to.x, y: to.y, size: this.#size }]);
	}

	/** Resize the active widget (clamped to its minimum size and the grid). */
	resizeTo(rect: Rect): void {
		if (!this.#live()) return;
		this.#size = { w: rect.w, h: rect.h };
		this.#setTarget([{ kind: "cell", x: rect.x, y: rect.y, size: this.#size }]);
	}

	/** Move the active widget to a reading-order index (the phone's reordering). */
	moveToIndex(index: number): void {
		if (!this.#live()) return;
		this.#setTarget([{ kind: "order", index, size: this.#size }]);
	}

	/**
	 * A keyboard step, from the preview as shown. Up, Left, and Right move one cell; Down moves
	 * past the next widget below in the same columns ("at-bottom" when there is none). On one
	 * column, Up/Down move one place in reading order and Left/Right are blocked.
	 */
	step(dir: ArrangeDirection): StepResult {
		const id = this.#live();
		const preview = this.#preview;
		if (!id || !preview) return "blocked";

		if (this.#columns() === 1) {
			if (dir === "left" || dir === "right") return "blocked";
			const index = preview.findIndex((i) => i.id === id);
			if (dir === "up" && index === 0) return "blocked";
			if (dir === "down" && index === preview.length - 1) return "at-bottom";
			const to = index + (dir === "up" ? -1 : 1);
			return this.#try({ kind: "order", index: to, size: null }, (after) =>
				after.findIndex((i) => i.id === id) !== index ? "moved" : "blocked"
			);
		}

		const cur = itemOf(preview, id).rect;
		let cell: { x: number; y: number };
		if (dir === "left") {
			if (cur.x === 0) return "blocked";
			cell = { x: cur.x - 1, y: cur.y };
		} else if (dir === "right") {
			if (cur.x + cur.w >= GRID_COLUMNS) return "blocked";
			cell = { x: cur.x + 1, y: cur.y };
		} else if (dir === "up") {
			if (cur.y === 0) return "blocked";
			cell = { x: cur.x, y: cur.y - 1 };
		} else {
			// Moving down one empty cell would snap back up, so Down passes the next widget below.
			const below = nextBelow(preview, id);
			if (!below) return "at-bottom";
			cell = { x: cur.x, y: below.rect.y + below.rect.h };
		}
		return this.#try({ kind: "cell", ...cell, size: null }, (after) =>
			sameRect(itemOf(after, id).rect, cur) ? "blocked" : "moved"
		);
	}

	/**
	 * Shift+arrows: Right/Left change the width by one, Down/Up the height (height only on one
	 * column), clamped to the widget's minimum size and the grid.
	 */
	grow(dir: ArrangeDirection): void {
		const id = this.#live();
		const preview = this.#preview;
		if (!id || !preview) return;
		const { rect, minSize } = itemOf(preview, id);
		let { w, h } = rect;
		if (dir === "up") h = Math.max(h - 1, minSize.h);
		else if (dir === "down") h += 1;
		else if (this.#columns() === 1) return;
		else if (dir === "left") w = Math.max(w - 1, minSize.w);
		else w = Math.min(w + 1, GRID_COLUMNS - rect.x);
		if (w === rect.w && h === rect.h) return;
		this.#size = { w, h };
		this.#setTarget([...this.#target, { kind: "size", w, h }]);
	}

	/**
	 * Apply the preview as one `setLayout` (built against the document as it is now) and end the
	 * arrangement. Returns the change, or null when nothing moved (nothing is applied then).
	 */
	drop(): Change | null {
		const id = this.#live();
		const preview = this.#preview;
		const target = this.#target;
		const session = this.#session();
		const doc = this.#doc();
		this.#clear();
		if (!id || !preview || !session || !doc || target.length === 0) return null;
		const change = layoutChange(doc.body.widgets, preview);
		if (!change) return null;
		session.apply(change);
		this.pendingFocus = id;
		// The document didn't take the change itself: it went to a starter's hand-off, and the
		// copy shows on a new page.
		if (session.editTarget.doc === doc) carried = { from: session, id };
		return change;
	}

	/** End the arrangement; nothing is applied. */
	cancel(): void {
		this.#clear();
		this.pendingFocus = null;
		this.pickUpRequest = null;
	}

	dispose(): void {
		this.#stop();
		this.#clear();
	}

	/** The document edits land in (a starter's copy once it has handed off). */
	#doc(): Dashboard | null {
		return this.#session()?.editTarget.doc ?? null;
	}

	#onGrid(id: string): boolean {
		const doc = this.#doc();
		return !!doc && doc.body.widgets.some((w) => w.id === id && !w.minimized);
	}

	/** The active widget's id, after noticing whether it has left the grid. */
	#live(): string | null {
		this.#checkGone();
		return this.#active?.id ?? null;
	}

	#checkGone(): void {
		const active = this.#active;
		if (!active || this.#onGrid(active.id)) return;
		untrack(() => {
			this.#clear();
			this.#onGone?.(active.id);
		});
	}

	#clear(): void {
		this.#active = null;
		this.#target = NO_TARGET;
		this.#size = null;
		this.#cache.clear();
		this.#cacheBase = null;
	}

	#setTarget(next: Target): void {
		const id = this.#active?.id;
		if (id && targetKey(id, next) === targetKey(id, this.#target)) return;
		this.#target = next;
	}

	/** Append a request; keep it only if `judge` says the preview moved. */
	#try(op: Op, judge: (after: Layout) => StepResult): StepResult {
		const previous = this.#target;
		this.#setTarget([...previous, op]);
		const after = this.#preview;
		const result = after ? judge(after) : "blocked";
		if (result !== "moved") this.#target = previous;
		return result;
	}

	#baseLayout(doc: Dashboard): Layout {
		if (this.#base?.doc === doc) return this.#base.layout;
		const fresh = shownLayout(doc.body.widgets, GRID_COLUMNS);
		const layout = this.#base && sameLayout(this.#base.layout, fresh) ? this.#base.layout : fresh;
		this.#base = { doc, layout };
		return layout;
	}

	#computePreview(): Layout | null {
		const active = this.#active;
		const target = this.#target;
		const doc = this.#doc();
		if (!active || !doc || !this.#onGrid(active.id)) return null;
		const base = this.#baseLayout(doc);
		if (this.#cacheBase !== base) {
			this.#cache.clear();
			this.#cacheBase = base;
		}
		// Each request applies to the layout before it; every prefix is cached, so a keypress
		// or a new pointer cell costs one engine call, and a remote change replays the requests.
		let layout = base;
		let key = active.id;
		for (const op of target) {
			key += `|${opKey(op)}`;
			let next = this.#cache.get(key);
			if (!next) {
				next = applyOp(layout, active.id, op);
				if (this.#cache.size >= CACHE_LIMIT) {
					// Drop the oldest entry (Maps keep insertion order).
					this.#cache.delete(this.#cache.keys().next().value!);
				}
				this.#cache.set(key, next);
			}
			layout = next;
		}
		return layout;
	}
}

function applyOp(layout: Layout, id: string, op: Op): Layout {
	if (op.kind === "size") {
		return resize(layout, id, { ...itemOf(layout, id).rect, w: op.w, h: op.h }, GRID_COLUMNS);
	}
	const size = op.size;
	const items = size
		? layout.map((i) => (i.id === id ? { ...i, rect: { ...i.rect, w: size.w, h: size.h } } : i))
		: layout;
	if (op.kind === "order") return moveInOrder(items, id, op.index, GRID_COLUMNS);
	return move(items, id, { x: op.x, y: op.y }, GRID_COLUMNS);
}
