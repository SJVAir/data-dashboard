import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MONTH_CALENDAR_TYPE } from "$lib/calendars/types";
import { CURRENT_SCHEMA_VERSION, type Dashboard, type WidgetInstance } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { AppContext } from "$lib/store/app.svelte";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { setShownSelection } from "$lib/calendars/shown-registry";
import { monthCalendarType } from "../month";
import { openDaysInChart } from "./open-in-chart";

/** Noon Pacific on Mon, Nov 9 2026: "today". */
const NOW = new Date("2026-11-09T20:00:00Z");

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(() => {
	vi.useRealTimers();
});

function calendar(selected: boolean): WidgetInstance {
	return {
		id: "cal",
		type: MONTH_CALENDAR_TYPE,
		title: null,
		rect: { x: 0, y: 0, w: 4, h: 6 },
		data: {
			dateRange: { kind: "custom", start: "2026-11-01", end: "2026-11-30" },
			...(selected ? { timeSubRange: { start: "2026-11-05", end: "2026-11-08" } } : {}),
			layers: [
				{
					dataset: "air-quality",
					entryType: "pm25",
					place: { kind: "monitor", id: "a" },
					resolution: "day"
				}
			]
		},
		thresholds: [{ level: "unhealthy" }]
	};
}

async function setup(selected: boolean, change?: (w: WidgetInstance) => void) {
	const platform = createMemoryPlatform();
	const doc: Dashboard = {
		kind: "dashboard",
		schemaVersion: CURRENT_SCHEMA_VERSION,
		id: "d1",
		name: null,
		version: 0,
		createdAt: "2026-10-20T00:00:00.000Z",
		updatedAt: "2026-10-20T00:00:00.000Z",
		body: { widgets: [calendar(selected)] }
	};
	change?.(doc.body.widgets[0]);
	await platform.documents.commit("anonymous", {
		docId: doc.id,
		baseVersion: null,
		doc,
		entries: []
	});
	const session = new DocumentSession({ platform, space: "anonymous", doc, tabId: "t" });
	const app = { current: { session, isStarter: false } } as unknown as AppContext;
	return { session, app };
}

const ctx = { target: {} as Element, payload: {} };

describe("open days in a chart", () => {
	it("adds a chart over the selected days and undoes in one step", async () => {
		const { session, app } = await setup(true);
		openDaysInChart(app, "cal");
		const widgets = session.doc.body.widgets;
		expect(widgets).toHaveLength(2);
		const chart = widgets[1];
		expect(chart.type).toBe("chart");
		expect(chart.title).toBeNull();
		expect(chart.data.dateRange).toEqual({
			kind: "custom",
			start: "2026-11-05",
			end: "2026-11-08"
		});
		expect(chart.data.timeSubRange).toBeUndefined();
		expect(chart.data.layers).toEqual([
			{ dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id: "a" } }
		]);
		expect(chart.thresholds).toEqual(widgets[0].thresholds);
		expect(chart.id).not.toBe("cal");
		expect(chart.minimized).toBeUndefined();
		session.undo();
		expect(session.doc.body.widgets).toHaveLength(1);
	});

	it("does nothing in a read-only session", async () => {
		const { session, app } = await setup(true);
		(session as unknown as { readOnly: string }).readOnly = "invalid";
		openDaysInChart(app, "cal");
		expect(session.doc.body.widgets).toHaveLength(1);
	});

	it("lists the menu item only while the mounted calendar shows a selection", async () => {
		const { session, app } = await setup(true);
		const env = { app, widget: () => session.doc.body.widgets[0] };
		expect(monthCalendarType.menu(ctx, env)).toEqual([]);
		const owner = Symbol("test");
		const remove = setShownSelection("cal", owner, { start: "2026-11-05", end: "2026-11-08" });
		expect(monthCalendarType.menu(ctx, env).map((i) => i.id)).toEqual(["calendar_open_in_chart"]);
		// A second copy (Get data's preview) going doesn't take the first one's away.
		const preview = Symbol("preview");
		setShownSelection("cal", preview, { start: "2026-11-05", end: "2026-11-05" })();
		expect(monthCalendarType.menu(ctx, env)).toHaveLength(1);
		remove();
		expect(monthCalendarType.menu(ctx, env)).toEqual([]);
	});

	it("charts the selection shown: none once a rolling range moved on, a partial one clipped", async () => {
		// "This month" on Dec 1: the November selection is out of the range.
		vi.setSystemTime(new Date("2026-12-01T20:00:00Z"));
		const moved = await setup(true, (w) => {
			w.data.dateRange = { kind: "to-date", unit: "month" };
		});
		openDaysInChart(moved.app, "cal");
		expect(moved.session.doc.body.widgets).toHaveLength(1);

		// The last 7 days on Nov 9 (Nov 3–9) show Nov 5–8 of a Nov 1–8 selection.
		vi.setSystemTime(NOW);
		const partial = await setup(true, (w) => {
			w.data.dateRange = { kind: "trailing", amount: 7, unit: "day" };
			w.data.timeSubRange = { start: "2026-11-01", end: "2026-11-08" };
		});
		openDaysInChart(partial.app, "cal");
		const chart = partial.session.doc.body.widgets[1];
		expect(chart.data.dateRange).toEqual({
			kind: "custom",
			start: "2026-11-03",
			end: "2026-11-08"
		});
	});
});
