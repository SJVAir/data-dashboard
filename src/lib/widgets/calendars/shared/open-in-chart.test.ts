import { describe, expect, it } from "vitest";
import { MONTH_CALENDAR_TYPE } from "$lib/calendars/types";
import { CURRENT_SCHEMA_VERSION, type Dashboard, type WidgetInstance } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { AppContext } from "$lib/store/app.svelte";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { monthCalendarType } from "../month";
import { openDaysInChart } from "./open-in-chart";

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
		thresholds: [{ value: 35, label: "Limit" } as never]
	};
}

async function setup(selected: boolean) {
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
		session.undo();
		expect(session.doc.body.widgets).toHaveLength(1);
	});

	it("lists the menu item only with a selection", async () => {
		for (const selected of [true, false]) {
			const { session, app } = await setup(selected);
			const items = monthCalendarType.menu(ctx, {
				app,
				widget: () => session.doc.body.widgets[0]
			});
			expect(items.map((i) => i.id)).toEqual(selected ? ["calendar_open_in_chart"] : []);
		}
	});
});
