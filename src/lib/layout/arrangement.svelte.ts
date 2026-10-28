import { getContext, untrack } from "svelte";
import type { Change } from "$lib/changes/types";
import type { Dashboard, Rect } from "$lib/documents/schema";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import { GRID_COLUMNS } from "./config";
import { move, moveInOrder, type Layout, type LayoutItem, type Size } from "./engine";
import { layoutChange, shownLayout } from "./items";

export type ArrangeMode = "move" | "resize";
export type ArrangeInput = "pointer" | "keyboard" | "touch";
export type ArrangeDirection = "up" | "down" | "left" | "right";
export type StepResult = "moved" | "at-bottom" | "blocked";

type Active = { id: string; mode: ArrangeMode; input: ArrangeInput };
/** Where the active widget was asked to go: a desktop cell, or a reading-order index (phone). */
type Position = { kind: "cell"; x: number; y: number } | { kind: "order"; index: number };
/** What the active widget was asked to do; `null` parts are unchanged from the document. */
type Target = { position: Position | null; size: Size | null };

const NO_TARGET: Target = { position: null, size: null };
/** Previews kept per document layout (a drag revisits cells; moveInOrder costs a few ms). */
const CACHE_LIMIT = 64;

export const ARRANGEMENT_KEY = Symbol("arrangement");

/** The dashboard page's arrangement controller, from context. */
export function useArrangement(): Arrangement {
	return getContext<Arrangement>(ARRANGEMENT_KEY);
}

function targetKey(id: string, t: Target): string {
	const p = t.position;
	const pos = !p ? "-" : p.kind === "cell" ? `${p.x},${p.y}` : `#${p.index}`;
	return `${id}|${pos}|${t.size ? `${t.size.w}x${t.size.h}` : "-"}`;
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
	/** The widget whose title bar should take focus once mounted (e.g. after a starter hand-off). */
	pendingFocus = $state<string | null>(null);

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
		this.#stop = $effect.root(() => {
			$effect(() => this.#checkGone());
		});
	}

	get active(): Active | null {
		const active = this.#active;
		return active && this.#onGrid(active.id) ? active : null;
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
		this.#active = { id, mode, input };
	}

	/** Move the active widget to a cell (engine `move`; widgets in the way are pushed down). */
	moveTo(to: { x: number; y: number }): void {
		if (!this.#live()) return;
		this.#setTarget({ position: { kind: "cell", x: to.x, y: to.y }, size: this.#target.size });
	}

	/** Resize the active widget (clamped to its minimum size and the grid). */
	resizeTo(rect: Rect): void {
		if (!this.#live()) return;
		this.#setTarget({
			position: { kind: "cell", x: rect.x, y: rect.y },
			size: { w: rect.w, h: rect.h }
		});
	}

	/** Move the active widget to a reading-order index (the phone's reordering). */
	moveToIndex(index: number): void {
		if (!this.#live()) return;
		this.#setTarget({ position: { kind: "order", index }, size: this.#target.size });
	}

	/**
	 * A keyboard step. Up, Left, and Right move one cell; Down moves past the next widget below
	 * in the same columns ("at-bottom" when there is none). On one column, Up/Down move one place
	 * in reading order and Left/Right are blocked.
	 */
	step(dir: ArrangeDirection): StepResult {
		const id = this.#live();
		const preview = this.#preview;
		if (!id || !preview) return "blocked";
		const size = this.#target.size;

		if (this.#columns() === 1) {
			if (dir === "left" || dir === "right") return "blocked";
			const index = preview.findIndex((i) => i.id === id);
			if (dir === "up" && index === 0) return "blocked";
			if (dir === "down" && index === preview.length - 1) return "at-bottom";
			const to = index + (dir === "up" ? -1 : 1);
			return this.#try({ position: { kind: "order", index: to }, size }, (after) =>
				after.findIndex((i) => i.id === id) !== index ? "moved" : "blocked"
			);
		}

		const cur = itemOf(preview, id).rect;
		// Left/Right keep the asked-for row: gravity may show the widget higher than asked.
		const position = this.#target.position;
		const askedY = position?.kind === "cell" ? position.y : cur.y;
		let cell: { x: number; y: number };
		if (dir === "left") {
			if (cur.x === 0) return "blocked";
			cell = { x: cur.x - 1, y: askedY };
		} else if (dir === "right") {
			if (cur.x + cur.w >= GRID_COLUMNS) return "blocked";
			cell = { x: cur.x + 1, y: askedY };
		} else if (dir === "up") {
			if (cur.y === 0) return "blocked";
			cell = { x: cur.x, y: cur.y - 1 };
		} else {
			// Moving down one empty cell would snap back up, so Down passes the next widget below.
			const below = nextBelow(preview, id);
			if (!below) return "at-bottom";
			cell = { x: cur.x, y: below.rect.y + below.rect.h };
		}
		return this.#try({ position: { kind: "cell", ...cell }, size }, (after) =>
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
		this.#setTarget({ position: this.#target.position, size: { w, h } });
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
		if (!id || !preview || !session || !doc || target === NO_TARGET) return null;
		const change = layoutChange(doc.body.widgets, preview);
		if (!change) return null;
		session.apply(change);
		this.pendingFocus = id;
		return change;
	}

	/** End the arrangement; nothing is applied. */
	cancel(): void {
		this.#clear();
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
		this.#cache.clear();
		this.#cacheBase = null;
	}

	#setTarget(next: Target): void {
		const id = this.#active?.id;
		if (id && targetKey(id, next) === targetKey(id, this.#target)) return;
		this.#target = next;
	}

	/** Set a target; keep it only if `judge` says the preview moved. */
	#try(next: Target, judge: (after: Layout) => StepResult): StepResult {
		const previous = this.#target;
		this.#setTarget(next);
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
		if (target === NO_TARGET) return base;
		if (this.#cacheBase !== base) {
			this.#cache.clear();
			this.#cacheBase = base;
		}
		const key = targetKey(active.id, target);
		let layout = this.#cache.get(key);
		if (!layout) {
			layout = previewFor(base, active.id, target);
			if (this.#cache.size >= CACHE_LIMIT) this.#cache.clear();
			this.#cache.set(key, layout);
		}
		return layout;
	}
}

function previewFor(base: Layout, id: string, target: Target): Layout {
	const { size, position } = target;
	const items = size
		? base.map((i) => (i.id === id ? { ...i, rect: { ...i.rect, w: size.w, h: size.h } } : i))
		: base;
	if (position?.kind === "order") return moveInOrder(items, id, position.index, GRID_COLUMNS);
	const cell = position ?? itemOf(items, id).rect;
	return move(items, id, { x: cell.x, y: cell.y }, GRID_COLUMNS);
}
