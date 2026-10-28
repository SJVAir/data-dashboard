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
