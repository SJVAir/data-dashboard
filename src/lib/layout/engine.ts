import type { Rect } from "$lib/documents/schema";

export type Size = { w: number; h: number };
export type LayoutItem = { id: string; rect: Rect; minSize: Size };
/** Always returned in reading order. */
export type Layout = LayoutItem[];

/** Layout items for widgets; call sites that don't need real minimum sizes get 1 x 1. */
export function toItems(widgets: { id: string; rect: Rect }[]): LayoutItem[] {
	return widgets.map((w) => ({ id: w.id, rect: w.rect, minSize: { w: 1, h: 1 } }));
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Sorted by row, then column, then id. */
export function readingOrder<T extends { id: string; rect: Rect }>(items: T[]): T[] {
	return [...items].sort(
		(a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
	);
}

/** A new item's rect: column 0, below everything. */
export function placeNew(items: LayoutItem[], size: Size, columns: number): Rect {
	const y = items.reduce((max, i) => Math.max(max, i.rect.y + i.rect.h), 0);
	return { x: 0, y, w: Math.min(size.w, columns), h: size.h };
}

function clampItem(item: LayoutItem, columns: number): LayoutItem {
	const w = Math.min(Math.max(item.rect.w, item.minSize.w, 1), columns);
	const h = Math.max(item.rect.h, item.minSize.h, 1);
	const x = Math.min(Math.max(item.rect.x, 0), columns - w);
	const y = Math.max(item.rect.y, 0);
	return { ...item, rect: { x, y, w, h } };
}

/**
 * Normalize a layout: clamp to the grid and each item's minimum size, resolve overlaps in
 * reading order by moving items down, then compact upward in reading order.
 */
export function tidy(items: LayoutItem[], columns: number): Layout {
	const clamped = readingOrder(items.map((i) => clampItem(i, columns)));

	const resolved: LayoutItem[] = [];
	for (const item of clamped) {
		let rect = item.rect;
		let hit = resolved.find((p) => rectsOverlap(p.rect, rect));
		while (hit) {
			rect = { ...rect, y: hit.rect.y + hit.rect.h };
			hit = resolved.find((p) => rectsOverlap(p.rect, rect));
		}
		resolved.push({ ...item, rect });
	}

	const placed: LayoutItem[] = [];
	for (const item of readingOrder(resolved)) {
		let y = item.rect.y;
		while (y > 0) {
			const up = { ...item.rect, y: y - 1 };
			if (placed.some((p) => rectsOverlap(p.rect, up))) break;
			y--;
		}
		placed.push({ ...item, rect: { ...item.rect, y } });
	}
	return readingOrder(placed);
}

/** Ids whose rect changed, with the after rect. */
export function diff(before: LayoutItem[], after: LayoutItem[]): Record<string, Rect> {
	const old = new Map(before.map((i) => [i.id, i.rect]));
	const out: Record<string, Rect> = {};
	for (const { id, rect } of after) {
		const o = old.get(id);
		if (!o || o.x !== rect.x || o.y !== rect.y || o.w !== rect.w || o.h !== rect.h) out[id] = rect;
	}
	return out;
}

/**
 * Put `id` at `rect` (clamped to the grid and its minimum size), push every widget it
 * overlaps down below it (cascading; the placed widget wins), then tidy.
 */
function place(items: LayoutItem[], id: string, rect: Rect, columns: number): Layout {
	const target = items.find((i) => i.id === id);
	if (!target) return tidy(items, columns);
	const placed: LayoutItem[] = [clampItem({ ...target, rect }, columns)];
	for (const other of readingOrder(items.filter((i) => i.id !== id))) {
		let r = other.rect;
		let hit = placed.find((p) => rectsOverlap(p.rect, r));
		while (hit) {
			r = { ...r, y: hit.rect.y + hit.rect.h };
			hit = placed.find((p) => rectsOverlap(p.rect, r));
		}
		placed.push({ ...other, rect: r });
	}
	return tidy(placed, columns);
}

/** Move a widget to a cell; widgets in the way are pushed down. */
export function move(
	items: LayoutItem[],
	id: string,
	to: { x: number; y: number },
	columns: number
): Layout {
	const target = items.find((i) => i.id === id);
	if (!target) return tidy(items, columns);
	return place(items, id, { ...target.rect, x: to.x, y: to.y }, columns);
}

/** Resize a widget (clamped to its minimum size and the grid); widgets in the way are pushed down. */
export function resize(items: LayoutItem[], id: string, rect: Rect, columns: number): Layout {
	return place(items, id, rect, columns);
}

/**
 * Move a widget just past the nearest widget below it whose columns it shares, or `null` when
 * there is none (it is already at the bottom).
 */
export function stepDown(items: LayoutItem[], id: string, columns: number): Layout | null {
	const target = items.find((i) => i.id === id);
	if (!target) return null;
	const { x, y, w } = target.rect;
	const below = readingOrder(
		items.filter((i) => i.id !== id && i.rect.y > y && i.rect.x < x + w && x < i.rect.x + i.rect.w)
	)[0];
	if (!below) return null;
	return move(items, id, { x, y: below.rect.y + below.rect.h }, columns);
}

/**
 * Move a widget so it sits at `index` in reading order (the phone's one-column reordering, in
 * desktop coordinates). When no cell puts it exactly there, it lands at the nearest index it can.
 */
export function moveInOrder(
	items: LayoutItem[],
	id: string,
	index: number,
	columns: number
): Layout {
	const order = readingOrder(items);
	const from = order.findIndex((i) => i.id === id);
	const to = Math.min(Math.max(index, 0), order.length - 1);
	if (from === -1 || from === to) return tidy(items, columns);
	const anchor = order[to].rect;
	const px = anchor.x;
	const py = from > to ? anchor.y : anchor.y + anchor.h;

	// The anchor's position usually works; when widths differ it can land one place off, so
	// try the nearest other cells until the widget reads at `to`.
	const w = Math.min(order[from].rect.w, columns);
	const bottom = items.reduce((max, i) => Math.max(max, i.rect.y + i.rect.h), 0);
	const cells: { x: number; y: number }[] = [];
	for (let y = 0; y <= bottom; y++) {
		for (let x = 0; x <= columns - w; x++) cells.push({ x, y });
	}
	const distance = (c: { x: number; y: number }) => Math.abs(c.y - py) + Math.abs(c.x - px);
	cells.sort((a, b) => distance(a) - distance(b) || a.y - b.y || a.x - b.x);

	// Some positions can't be reached without resizing (a full-width widget can't sit between
	// widgets that start on the same row); then the nearest reachable position wins.
	let best: Layout | null = null;
	let bestOff = Infinity;
	for (const cell of [{ x: px, y: py }, ...cells]) {
		const result = move(items, id, cell, columns);
		const off = Math.abs(result.findIndex((i) => i.id === id) - to);
		if (off === 0) return result;
		if (off < bestOff) [best, bestOff] = [result, off];
	}
	return best!;
}
