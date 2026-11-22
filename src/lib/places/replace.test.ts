import { describe, expect, it } from "vitest";
import type { ChosenPlace, Layer, WidgetDataConfig } from "$lib/data/schema";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { MAP_TYPE } from "$lib/widgets/map";
import {
	barChange,
	barVisible,
	mainPlaces,
	othersCount,
	replaceChange,
	replacePlace,
	widgetPlace
} from "./replace";

const A: ChosenPlace = { kind: "region", type: "county", code: "fresno" };
const B: ChosenPlace = { kind: "region", type: "county", code: "kern" };
const C: ChosenPlace = { kind: "region", type: "county", code: "tulare" };

type Where = Pick<WidgetDataConfig, "place" | "selection">;
const MONITORS: Layer = { dataset: "monitors" };
/** A Chart with this Where, of `layers` (a monitors layer). */
function widget(
	id: string,
	where: Where,
	layers: Layer[] = [MONITORS],
	y = 0,
	x = 0
): WidgetInstance {
	return {
		id,
		type: "chart",
		title: null,
		rect: { x, y, w: 4, h: 4 },
		data: { ...where, layers }
	};
}
const at = (place: ChosenPlace): Where => ({ place });
/** Several places: never rewritten. */
const SEVERAL: Where = { selection: { kind: "regions", ids: ["county:fresno", "county:kern"] } };

function doc(widgets: WidgetInstance[], bar?: ChosenPlace): Dashboard {
	return {
		id: "d",
		name: "D",
		body: { widgets, ...(bar ? { placeBar: { place: bar } } : {}) }
	} as unknown as Dashboard;
}

describe("widgetPlace", () => {
	it("is the widget's one place, whatever its layers", () => {
		expect(widgetPlace(widget("w", at(A)))).toEqual(A);
		expect(widgetPlace(widget("w", at(A), [MONITORS, { dataset: "hms" }]))).toEqual(A);
	});
	it("is null with no places (a Note, or everywhere)", () => {
		expect(widgetPlace(widget("w", {}, []))).toBeNull();
		expect(widgetPlace(widget("w", {}, [{ dataset: "weather" }]))).toBeNull();
	});
	it("is mixed for a selection, a chosen weather station, or default-place", () => {
		expect(widgetPlace(widget("w", { selection: { kind: "regions", ids: ["county:a"] } }))).toBe(
			"mixed"
		);
		expect(widgetPlace(widget("w", SEVERAL))).toBe("mixed");
		expect(widgetPlace(widget("w", at(A), [{ dataset: "weather", station: "KFAT" }]))).toBe(
			"mixed"
		);
		expect(widgetPlace(widget("w", { place: { kind: "default-place" } }))).toBe("mixed");
	});
});

describe("replacePlace", () => {
	const d = doc(
		[
			widget("a", at(A)),
			widget("b", at(B)),
			widget("mix", SEVERAL),
			widget("note", {}, []),
			widget("sta", at(A), [{ dataset: "weather", station: "KFAT" }])
		],
		A
	);
	it("switches only widgets at from, and moves the bar", () => {
		const next = replacePlace(d, A, C, { others: false });
		const ws = next.body.widgets;
		expect(ws[0].data.place).toEqual(C);
		expect(ws[1]).toBe(d.body.widgets[1]);
		expect(ws[2]).toBe(d.body.widgets[2]);
		expect(ws[3]).toBe(d.body.widgets[3]);
		expect(ws[4]).toBe(d.body.widgets[4]);
		expect(next.body.placeBar).toEqual({ place: C });
	});
	it("with others, switches single-place widgets at other places too", () => {
		const next = replacePlace(d, A, C, { others: true });
		expect(next.body.widgets[1].data.place).toEqual(C);
		expect(next.body.widgets[2]).toBe(d.body.widgets[2]);
		expect(next.body.widgets[3]).toBe(d.body.widgets[3]);
	});
	it("leaves a widget with no Where alone (its monitors are on its layer)", () => {
		const onMonitor = widget("mon", {}, [
			{ dataset: "air-quality", entryType: "pm25", monitors: ["m1"] }
		]);
		const e = doc([widget("a", at(A)), onMonitor], A);
		for (const others of [false, true]) {
			const next = replacePlace(e, A, C, { others });
			expect(next.body.widgets[1]).toBe(onMonitor);
		}
	});
	it("leaves the bar when it isn't at from, and keeps the layers", () => {
		const layers = [MONITORS, { dataset: "hms" }];
		const e = doc([widget("a", at(A), layers)], B);
		const next = replacePlace(e, A, C, { others: false });
		expect(next.body.placeBar).toEqual({ place: B });
		expect(next.body.widgets[0].data).toEqual({ place: C, layers });
	});
});

describe("a school or point bar place and areas-only widgets", () => {
	const SCHOOL: ChosenPlace = { kind: "location", source: "cde-public", code: "1" };
	const POINT: ChosenPlace = { kind: "point", lat: 36.7, lon: -119.8 };
	const typed = (id: string, type: string): WidgetInstance => ({ ...widget(id, at(A)), type });
	const d = doc(
		[typed("chart", "chart"), typed("table", "data-table"), typed("now", "current-conditions")],
		A
	);
	it("leaves Charts and Tables at their own Where; other widgets and the bar move", () => {
		for (const to of [SCHOOL, POINT]) {
			const next = replacePlace(d, A, to, { others: true });
			expect(next.body.widgets[0]).toBe(d.body.widgets[0]);
			expect(next.body.widgets[1]).toBe(d.body.widgets[1]);
			expect(next.body.widgets[2].data.place).toEqual(to);
			expect(next.body.placeBar).toEqual({ place: to });
		}
	});
	it("an area moves them all", () => {
		const next = replacePlace(d, A, B, { others: false });
		expect(next.body.widgets.map((w) => w.data.place)).toEqual([B, B, B]);
	});
	it("othersCount with a school counts only the widgets it would change", () => {
		const e = doc([typed("chart", "chart"), typed("now", "current-conditions")], B);
		expect(othersCount(e, B)).toBe(2);
		expect(othersCount(e, B, SCHOOL)).toBe(1);
		expect(othersCount(e, B, C)).toBe(2);
	});
});

describe("a Map and Change place", () => {
	const AIR: Layer = { dataset: "air-quality" };
	const mapWidget = (id: string, where: Where): WidgetInstance => ({
		...widget(id, where, [AIR]),
		type: MAP_TYPE
	});
	const several: Where = { selection: { kind: "regions", ids: ["county:a", "county:b"] } };
	it("a one-place Map moves with the bar", () => {
		const d = doc([mapWidget("m", at(A))], A);
		const next = replacePlace(d, A, C, { others: false });
		expect(next.body.widgets[0].data.place).toEqual(C);
		expect(next.body.placeBar).toEqual({ place: C });
	});
	it("a several-place Map stays", () => {
		const d = doc([mapWidget("m", several)], A);
		expect(widgetPlace(d.body.widgets[0])).toBe("mixed");
		const next = replacePlace(d, A, C, { others: true });
		expect(next.body.widgets[0]).toBe(d.body.widgets[0]);
	});
});

describe("othersCount, barVisible, mainPlaces", () => {
	const d = doc(
		[widget("a", at(A)), widget("b", at(B)), widget("c", at(B)), widget("m", SEVERAL)],
		A
	);
	it("counts single-place widgets at another place", () => {
		expect(othersCount(d, A)).toBe(2);
		expect(othersCount(d, B)).toBe(1);
	});
	it("shows the bar only with a widget at its place", () => {
		expect(barVisible(d)).toBe(true);
		expect(barVisible(doc([widget("b", at(B))], A))).toBe(false);
		expect(barVisible(doc([widget("a", at(A))]))).toBe(false);
	});
	it("gives the most common places, all of a tie in reading order", () => {
		expect(mainPlaces(d)).toEqual([B]);
		const tie = doc([
			widget("x", at(B), [MONITORS], 2),
			widget("y", at(A), [MONITORS], 0),
			widget("z", {}, [])
		]);
		expect(mainPlaces(tie)).toEqual([A, B]);
		expect(mainPlaces(doc([widget("z", {}, [])]))).toEqual([]);
	});
});

describe("replaceChange", () => {
	const d = doc([widget("a", at(A)), widget("b", at(A)), widget("c", at(B))], A);
	it("is null when nothing changed", () => {
		expect(replaceChange(d, d)).toBeNull();
	});
	it("is setWidgetData for one changed widget with the bar unmoved", () => {
		const next = replacePlace(doc(d.body.widgets, B), A, C, { others: false });
		// bar at B stays, widgets a and b both change: two widgets -> replaceDocument
		expect(replaceChange(doc(d.body.widgets, B), next)?.op).toBe("replaceDocument");
		const one = doc([widget("a", at(A)), widget("c", at(B))], B);
		const change = replaceChange(one, replacePlace(one, A, C, { others: false }));
		expect(change).toMatchObject({ op: "setWidgetData", target: { widgetId: "a" } });
	});
	it("is one replaceDocument when several widgets or the bar change", () => {
		const next = replacePlace(d, A, C, { others: false });
		const change = replaceChange(d, next);
		expect(change).toMatchObject({ op: "replaceDocument", target: {} });
		const single = doc([widget("a", at(A))], A);
		expect(replaceChange(single, replacePlace(single, A, C, { others: false }))?.op).toBe(
			"replaceDocument"
		);
	});
});

describe("replacing a place with itself", () => {
	it("leaves the document as it was, so there's no change (no undo step)", () => {
		const d = doc([widget("a", at(A)), widget("b", at(B))], A);
		const same = replacePlace(d, A, { ...A }, { others: false });
		expect(same).toBe(d);
		expect(replaceChange(d, same)).toBeNull();
	});
});

describe("barChange", () => {
	it("switches the bar's widgets (and with others, the rest) as one change", () => {
		const d = doc([widget("a", at(A)), widget("b", at(B)), widget("c", at(A))], A);
		const change = barChange(d, C, { others: false })!;
		expect(change.op).toBe("replaceDocument");
		const to = (change as { to: { body: Dashboard["body"] } }).to.body;
		expect(to.placeBar).toEqual({ place: C });
		expect(to.widgets.map((w) => w.data.place)).toEqual([C, B, C]);
		const all = (barChange(d, C, { others: true }) as { to: { body: Dashboard["body"] } }).to.body;
		expect(all.widgets.map((w) => w.data.place)).toEqual([C, C, C]);
	});
	it("is null with no bar, or at the bar's own place", () => {
		expect(barChange(doc([widget("a", at(A))]), C, { others: false })).toBeNull();
		expect(barChange(doc([widget("a", at(A))], A), A, { others: true })).toBeNull();
	});
});

describe("the bar's own place with Also change", () => {
	it("brings the other single-place widgets to it as one change; the bar stays", () => {
		const mixed = widget("m", SEVERAL);
		const d = doc([widget("a", at(A)), widget("b", at(B)), widget("c", at(C)), mixed], A);
		const next = replacePlace(d, A, A, { others: true });
		expect(next.body.widgets[0]).toBe(d.body.widgets[0]);
		expect(next.body.widgets[3]).toBe(mixed);
		expect(next.body.placeBar).toBe(d.body.placeBar);
		expect(next.body.widgets.map((w) => w.data.place)).toEqual([A, A, A, undefined]);
		const change = replaceChange(d, next)!;
		expect(change.op).toBe("replaceDocument");
		expect(barChange(d, A, { others: true })).toEqual(change);
	});
	it("is no change without Also change, or with nothing elsewhere", () => {
		const d = doc([widget("a", at(A)), widget("b", at(B))], A);
		expect(barChange(d, A, { others: false })).toBeNull();
		const only = doc([widget("a", at(A))], A);
		expect(barChange(only, A, { others: true })).toBeNull();
	});
	it("with one other widget, is that widget's change", () => {
		const d = doc([widget("a", at(A)), widget("b", at(B))], A);
		expect(barChange(d, A, { others: true })?.op).toBe("setWidgetData");
	});
});
