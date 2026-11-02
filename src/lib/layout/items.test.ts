import { describe, expect, test } from "vitest";
import type { WidgetInstance } from "$lib/documents/schema";
import { registerWidgetType } from "$lib/widgets/registry";
import { placeholderType } from "$lib/widgets/placeholder";
import { move } from "./engine";
import { FALLBACK_MIN_SIZE, gridItems, layoutChange, placeNewWidget, shownLayout } from "./items";

function widget(id: string, type: string, x: number, y: number, w = 4, h = 3): WidgetInstance {
	return { id, type, title: null, rect: { x, y, w, h }, data: {} } as WidgetInstance;
}

describe("layout items", () => {
	test("the fallback minimum is the placeholder's", () => {
		expect(FALLBACK_MIN_SIZE).toEqual(placeholderType.minSize);
		expect(FALLBACK_MIN_SIZE).toEqual({ w: 3, h: 2 });
	});

	test("known types use their own minimum", () => {
		registerWidgetType({ ...placeholderType, type: "items-test", minSize: { w: 5, h: 4 } });
		expect(gridItems([widget("a", "items-test", 0, 0)])[0].minSize).toEqual({ w: 5, h: 4 });
	});

	test("unknown types use the fallback minimum", () => {
		const items = gridItems([widget("a", "no-such-type", 0, 0)]);
		expect(items[0].minSize).toEqual(FALLBACK_MIN_SIZE);
		expect(items[0].rect).toEqual({ x: 0, y: 0, w: 4, h: 3 });
	});

	test("shownLayout tidies", () => {
		const layout = shownLayout([
			widget("a", "placeholder", 0, 5),
			widget("b", "placeholder", 4, 9)
		]);
		expect(layout.map((i) => i.rect.y)).toEqual([0, 0]);
	});

	test("placeNewWidget places below everything", () => {
		const rect = placeNewWidget([widget("a", "placeholder", 0, 0, 4, 3)], { w: 6, h: 4 });
		expect(rect).toEqual({ x: 0, y: 3, w: 6, h: 4 });
	});

	test("gridItems skips minimized widgets", () => {
		const m = { ...widget("m", "placeholder", 0, 0), minimized: { order: 0 } };
		expect(gridItems([widget("a", "placeholder", 0, 0), m]).map((i) => i.id)).toEqual(["a"]);
	});

	test("placeNewWidget ignores minimized widgets", () => {
		const m = { ...widget("m", "placeholder", 0, 20), minimized: { order: 0 } };
		const rect = placeNewWidget([widget("a", "placeholder", 0, 0, 4, 3), m], { w: 6, h: 4 });
		expect(rect).toEqual({ x: 0, y: 3, w: 6, h: 4 });
	});

	test("layoutChange includes tidy fixes", () => {
		const widgets = [
			widget("a", "placeholder", 0, 0, 6, 2),
			widget("b", "placeholder", 0, 5, 6, 2)
		];
		const after = move(gridItems(widgets), "a", { x: 6, y: 0 }, 12);
		const change = layoutChange(widgets, after);
		expect(change?.op).toBe("setLayout");
		if (change?.op !== "setLayout") return;
		expect(change.target.widgetIds.sort()).toEqual(["a", "b"]);
		expect(change.from.b).toEqual({ rect: { x: 0, y: 5, w: 6, h: 2 }, minimized: null });
		expect(change.to.b.rect).toEqual({ x: 0, y: 0, w: 6, h: 2 });
	});

	test("layoutChange returns null when nothing moved", () => {
		const widgets = [
			widget("a", "placeholder", 0, 0, 6, 2),
			widget("b", "placeholder", 6, 0, 6, 2)
		];
		expect(layoutChange(widgets, shownLayout(widgets))).toBeNull();
	});
});
