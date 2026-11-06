import { describe, expect, it } from "vitest";
import { cancelPlan, parseGetDataMode } from "./mode";

describe("parseGetDataMode", () => {
	it("reads /data, a new widget and Edit data from the route's params", () => {
		expect(parseGetDataMode({})).toEqual({ kind: "new", dashboardId: undefined });
		expect(parseGetDataMode({ id: "d1" })).toEqual({ kind: "new", dashboardId: "d1" });
		expect(parseGetDataMode({ id: "d1", widgetId: "w1" })).toEqual({
			kind: "edit",
			dashboardId: "d1",
			widgetId: "w1"
		});
	});
});

describe("cancelPlan", () => {
	const pushed = { _routerIndex: 2, _userState: null };
	const first = { _routerIndex: 0, _userState: null };

	it("goes back when the app pushed this entry", () => {
		expect(cancelPlan(pushed, { kind: "new" })).toEqual({ kind: "back" });
	});

	it("opened on the link (or with no router state), goes to where the view came from", () => {
		expect(cancelPlan(first, { kind: "new" })).toEqual({ kind: "go", path: "/" });
		expect(cancelPlan(null, { kind: "new", dashboardId: "d1" })).toEqual({
			kind: "go",
			path: "/dashboards/:id",
			id: "d1"
		});
		expect(cancelPlan(first, { kind: "edit", dashboardId: "d1", widgetId: "w1" })).toEqual({
			kind: "go",
			path: "/dashboards/:id",
			id: "d1"
		});
	});
});
