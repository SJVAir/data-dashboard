import type { SetLayoutChange } from "$lib/changes/types";
import type { Rect, WidgetInstance } from "$lib/documents/schema";
import { GRID_COLUMNS, MAX_HEIGHT, MAX_ROW } from "./config";
import { move, moveInOrder, resize, type Layout, type LayoutItem, type Size } from "./engine";
import { layoutChange } from "./items";

export type ArrangeDirection = "up" | "down" | "left" | "right";
export type StepResult = "moved" | "at-bottom" | "blocked";

/**
 * One request for an arranged widget, applied to the layout before it: move to a desktop cell,
 * move to a reading-order index (phone), or resize in place. A cell or index request may carry
 * a size to take first.
 */
export type Op =
	| { kind: "cell"; x: number; y: number; size: Size | null }
	| { kind: "order"; index: number; size: Size | null }
	| { kind: "size"; w: number; h: number };

export function sameRect(a: Rect, b: Rect): boolean {
	return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function itemOf(layout: Layout, id: string): LayoutItem {
	return layout.find((i) => i.id === id)!;
}

/** The nearest widget below `id` that shares its columns (what moving down passes). */
function nextBelow(layout: Layout, id: string): LayoutItem | undefined {
	const { x, y, w } = itemOf(layout, id).rect;
	return layout.find(
		(i) => i.id !== id && i.rect.y > y && i.rect.x < x + w && x < i.rect.x + i.rect.w
	);
}

/** `op` applied to `layout` for widget `id` (layouts are in desktop, 12-column, coordinates). */
export function applyOp(layout: Layout, id: string, op: Op): Layout {
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

/**
 * A keyboard step's request from `layout`, or why there is none. Up, Left, and Right move one
 * cell; Down moves past the next widget below in the same columns ("at-bottom" when there is
 * none). On one column, Up/Down move one place in reading order and Left/Right are blocked.
 */
export function stepOp(
	layout: Layout,
	id: string,
	dir: ArrangeDirection,
	columns: number
): Op | "at-bottom" | "blocked" {
	if (columns === 1) {
		if (dir === "left" || dir === "right") return "blocked";
		const index = layout.findIndex((i) => i.id === id);
		if (dir === "up" && index === 0) return "blocked";
		if (dir === "down" && index === layout.length - 1) return "at-bottom";
		return { kind: "order", index: index + (dir === "up" ? -1 : 1), size: null };
	}
	const cur = itemOf(layout, id).rect;
	if (dir === "left") {
		return cur.x === 0 ? "blocked" : { kind: "cell", x: cur.x - 1, y: cur.y, size: null };
	}
	if (dir === "right") {
		if (cur.x + cur.w >= GRID_COLUMNS) return "blocked";
		return { kind: "cell", x: cur.x + 1, y: cur.y, size: null };
	}
	if (dir === "up") {
		return cur.y === 0 ? "blocked" : { kind: "cell", x: cur.x, y: cur.y - 1, size: null };
	}
	// Moving down one empty cell would snap back up, so Down passes the next widget below.
	const below = nextBelow(layout, id);
	if (!below) return "at-bottom";
	return { kind: "cell", x: cur.x, y: below.rect.y + below.rect.h, size: null };
}

/** Whether `after` moved widget `id` from where it is in `before` (its place, on one column). */
export function stepMoved(before: Layout, after: Layout, id: string, columns: number): boolean {
	if (columns === 1) {
		return after.findIndex((i) => i.id === id) !== before.findIndex((i) => i.id === id);
	}
	return !sameRect(itemOf(after, id).rect, itemOf(before, id).rect);
}

/**
 * A Shift+arrow step's new size: Right/Left change the width by one, Down/Up the height
 * (height only on one column), clamped to the widget's minimum size and the grid. Null when
 * it wouldn't change.
 */
export function growSize(
	layout: Layout,
	id: string,
	dir: ArrangeDirection,
	columns: number
): Size | null {
	const { rect, minSize } = itemOf(layout, id);
	let { w, h } = rect;
	if (dir === "up") h = Math.max(h - 1, minSize.h);
	else if (dir === "down") h = Math.min(h + 1, MAX_HEIGHT);
	else if (columns === 1) return null;
	else if (dir === "left") w = Math.max(w - 1, minSize.w);
	else w = Math.min(w + 1, GRID_COLUMNS - rect.x);
	return w === rect.w && h === rect.h ? null : { w, h };
}

/**
 * The `setLayout` that saves `after` for widget `id` (built against `widgets` and their shown
 * layout `before`), or null when nothing would be saved: the widget is where it was (an undo
 * entry with no visible change would surprise, even if tidying would change others), or the
 * layout would pass the row caps (`MAX_ROW`, `MAX_HEIGHT`; the schema would reject it).
 */
export function dropChange(
	widgets: WidgetInstance[],
	before: Layout,
	after: Layout,
	id: string
): SetLayoutChange | null {
	const was = before.find((i) => i.id === id);
	if (was && sameRect(was.rect, itemOf(after, id).rect)) return null;
	if (after.some((i) => i.rect.y > MAX_ROW || i.rect.h > MAX_HEIGHT)) return null;
	return layoutChange(widgets, after);
}

/** A Move or Size submenu item: one keyboard step, one Shift+arrow step, or to an end. */
export type LayoutAction =
	| { kind: "step"; dir: ArrangeDirection }
	| { kind: "grow"; dir: ArrangeDirection }
	| { kind: "end"; end: "top" | "bottom" };

/**
 * The layout after `action` on widget `id`, or null when it wouldn't move or resize it. A step
 * and a grow give exactly what one arrow or Shift+arrow press and a drop give. To top / To
 * bottom: first or last in reading order on one column; otherwise row 0, or below the lowest
 * other widget, in its own columns (then gravity settles it, as a pointer drag there would).
 */
export function actionLayout(
	layout: Layout,
	id: string,
	action: LayoutAction,
	columns: number
): Layout | null {
	let op: Op | "at-bottom" | "blocked";
	if (action.kind === "step") op = stepOp(layout, id, action.dir, columns);
	else if (action.kind === "grow") {
		const size = growSize(layout, id, action.dir, columns);
		op = size ? { kind: "size", ...size } : "blocked";
	} else if (columns === 1) {
		const index = action.end === "top" ? 0 : layout.length - 1;
		op = { kind: "order", index, size: null };
	} else {
		const { x } = itemOf(layout, id).rect;
		const bottom = Math.max(
			0,
			...layout.filter((i) => i.id !== id).map((i) => i.rect.y + i.rect.h)
		);
		op = { kind: "cell", x, y: action.end === "top" ? 0 : bottom, size: null };
	}
	if (typeof op === "string") return null;
	const after = applyOp(layout, id, op);
	const changed =
		!sameRect(itemOf(after, id).rect, itemOf(layout, id).rect) ||
		stepMoved(layout, after, id, columns);
	return changed ? after : null;
}
