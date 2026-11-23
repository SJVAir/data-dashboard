import { describe, expect, it } from "vitest";
import type { Dashboard } from "$lib/documents/schema";
import { resolveDefaultPlace } from "./resolve";

const SCHOOL = { kind: "location", source: "schools", code: "123" } as const;
const CLOVIS = { kind: "region", type: "city", code: "0614218" } as const;

const doc: Dashboard = {
	kind: "dashboard",
	schemaVersion: 1,
	id: "d",
	name: null,
	version: 0,
	createdAt: "2026-10-20T00:00:00Z",
	updatedAt: "2026-10-20T00:00:00Z",
	body: {
		widgets: [
			{
				id: "a",
				type: "chart",
				title: null,
				rect: { x: 0, y: 0, w: 3, h: 4 },
				data: {
					place: { kind: "default-place" },
					layers: [
						{ dataset: "air-quality", entryType: "pm25" },
						{ dataset: "air-quality", entryType: "pm25" },
						{ dataset: "forecasts", entryType: "burn-status" }
					]
				}
			},
			{
				id: "c",
				type: "chart",
				title: null,
				rect: { x: 0, y: 4, w: 3, h: 4 },
				data: { place: CLOVIS, layers: [{ dataset: "air-quality", entryType: "pm25" }] }
			},
			{
				id: "b",
				type: "note",
				title: null,
				rect: { x: 3, y: 0, w: 3, h: 4 },
				data: { layers: [] },
				options: { text: "" }
			}
		]
	}
};

describe("resolveDefaultPlace", () => {
	it("replaces every default-place and leaves other places alone", () => {
		const resolved = resolveDefaultPlace(doc, SCHOOL);
		expect(resolved.body.widgets.map((w) => w.data.place)).toEqual([SCHOOL, CLOVIS, undefined]);
		expect(resolved.body.widgets[0].data.layers).toEqual(doc.body.widgets[0].data.layers);
		expect(resolved.body.widgets[2]).toEqual(doc.body.widgets[2]);
	});

	it("returns a new object and leaves its input as it was", () => {
		const before = structuredClone(doc);
		const resolved = resolveDefaultPlace(doc, SCHOOL);
		expect(resolved).not.toBe(doc);
		expect(doc).toEqual(before);
		// The place is copied, so editing one widget's place doesn't change another's.
		const place = resolved.body.widgets[0].data.place;
		expect(place).not.toBe(SCHOOL);
	});
});
