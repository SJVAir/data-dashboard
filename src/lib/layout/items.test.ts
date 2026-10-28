import { describe, expect, test } from "vitest";
import type { WidgetInstance } from "$lib/documents/schema";
import { registerWidgetType } from "$lib/widgets/registry";
import { placeholderType } from "$lib/widgets/placeholder";
import { FALLBACK_MIN_SIZE, gridItems, placeNewWidget, shownLayout } from "./items";

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
});
