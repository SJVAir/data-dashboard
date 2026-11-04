import { afterEach, describe, expect, test, vi } from "vitest";
import type { Component } from "svelte";
import {
	addableWidgetTypes,
	getWidgetType,
	loadWidget,
	registerWidgetType,
	type WidgetModule,
	type WidgetType
} from "./registry";
import { updateNotice } from "$lib/safety/update-notice.svelte";

// A failed load sets the app-wide reload notice.
afterEach(() => {
	updateNotice.reason = null;
});

const component = (() => {}) as unknown as WidgetModule["component"];

function type(name: string, extra: Partial<WidgetType> = {}): WidgetType {
	return {
		type: name,
		label: () => name,
		icon: (() => {}) as unknown as Component,
		minSize: { w: 3, h: 2 },
		defaultSize: { w: 3, h: 4 },
		time: "none",
		thresholds: false,
		analyzable: false,
		downloadable: false,
		menu: () => [],
		load: async () => ({ component }),
		...extra
	};
}

describe("widget registry", () => {
	test("a registered type is found by its name; others aren't", () => {
		const t = type("registry-lookup");
		registerWidgetType(t);
		expect(getWidgetType("registry-lookup")).toBe(t);
		expect(getWidgetType("registry-missing")).toBeUndefined();
	});

	test("registering a name again replaces the type", () => {
		registerWidgetType(type("registry-replace"));
		const again = type("registry-replace", { minSize: { w: 5, h: 5 } });
		registerWidgetType(again);
		expect(getWidgetType("registry-replace")).toBe(again);
	});

	test("only types with `addable` are offered, in registration order", () => {
		const data = { layers: [] };
		registerWidgetType(type("registry-addable-a", { addable: () => data }));
		registerWidgetType(type("registry-not-addable"));
		registerWidgetType(type("registry-addable-b", { addable: () => data }));
		const names = addableWidgetTypes().map((t) => t.type);
		expect(names).toContain("registry-addable-a");
		expect(names).toContain("registry-addable-b");
		expect(names).not.toContain("registry-not-addable");
		expect(names.indexOf("registry-addable-a")).toBeLessThan(names.indexOf("registry-addable-b"));
	});

	test("a type's module loads once for two calls", async () => {
		const load = vi.fn(async () => ({ component }));
		const t = type("registry-load-once", { load });
		const [a, b] = await Promise.all([loadWidget(t), loadWidget(t)]);
		expect(await loadWidget(t)).toBe(a);
		expect(b).toBe(a);
		expect(a.component).toBe(component);
		expect(load).toHaveBeenCalledTimes(1);
	});

	test("a failed load isn't kept: the next call tries again", async () => {
		const load = vi
			.fn<() => Promise<WidgetModule>>()
			.mockRejectedValueOnce(new Error("chunk gone"))
			.mockResolvedValueOnce({ component });
		const t = type("registry-retry", { load });
		await expect(loadWidget(t)).rejects.toThrow("chunk gone");
		await expect(loadWidget(t)).resolves.toEqual({ component });
		expect(load).toHaveBeenCalledTimes(2);
	});

	test("each type loads its own module", async () => {
		const other = (() => {}) as unknown as WidgetModule["component"];
		const a = type("registry-own-a");
		const b = type("registry-own-b", { load: async () => ({ component: other }) });
		expect((await loadWidget(a)).component).toBe(component);
		expect((await loadWidget(b)).component).toBe(other);
	});
});
