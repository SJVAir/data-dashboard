import type { Rect, WidgetInstance } from "$lib/documents/schema";

export function rectsOverlap(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function placeAtBottom(widgets: WidgetInstance[], size: { w: number; h: number }): Rect {
	const y = widgets.reduce((max, w) => Math.max(max, w.rect.y + w.rect.h), 0);
	return { x: 0, y, w: size.w, h: size.h };
}

export function readingOrder(widgets: WidgetInstance[]): WidgetInstance[] {
	return [...widgets].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
}
