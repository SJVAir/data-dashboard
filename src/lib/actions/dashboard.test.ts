import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "$lib/store/app.svelte";
import { STARTER_ID } from "$lib/starter/starter";
import { chartType } from "$lib/widgets/chart";
import { registerWidgetType } from "$lib/widgets/registry";
import { navigate } from "../../router";
import { startGetData, dashboardActions } from "./dashboard";
import { isDisabled } from "./types";

vi.mock("../../router", () => ({ navigate: vi.fn(async () => {}) }));
vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

const CTX = { target: {} as Element, payload: {} };

function app(isStarter = false, readOnly: false | "newer" = false): AppContext {
	return {
		current: { session: { doc: { id: "d1" }, readOnly }, isStarter },
		index: { names: new Map() }
	} as unknown as AppContext;
}

beforeEach(() => {
	vi.mocked(navigate).mockClear();
	registerWidgetType(chartType);
});

describe("Add widget", () => {
	it("Add widget's Chart item opens Get data for this dashboard", async () => {
		const items = dashboardActions(app())(CTX);
		const add = items.find((i) => i.id === "add-widget");
		const chart = add?.children?.find((i) => i.id === "add-widget-chart");
		expect(chart).toBeDefined();
		await chart?.run?.(CTX);
		expect(navigate).toHaveBeenCalledWith("/dashboards/:id/widgets/new", {
			params: { id: "d1" },
			search: { type: "chart" }
		});
	});

	it("on the starter it opens Get data for the starter", () => {
		startGetData(app(true), "chart");
		expect(navigate).toHaveBeenCalledWith("/dashboards/:id/widgets/new", {
			params: { id: STARTER_ID },
			search: { type: "chart" }
		});
	});

	it("on a read-only dashboard it opens nothing", () => {
		startGetData(app(false, "newer"), "chart");
		expect(navigate).not.toHaveBeenCalled();
	});

	it("a locked dashboard disables Add widget", () => {
		const add = dashboardActions(app(false, "newer"))(CTX).find((i) => i.id === "add-widget");
		expect(add && isDisabled(add)).toBe(true);
	});
});
