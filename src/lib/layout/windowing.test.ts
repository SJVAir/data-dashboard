import { describe, expect, test } from "vitest";
import { changesOverlap } from "$lib/changes/overlap";
import type { Change } from "$lib/changes/types";
import { CURRENT_SCHEMA_VERSION, type Dashboard, type WidgetInstance } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { minimizeChange, nextMinimizedOrder, restoreChange, taskbarWidgets } from "./windowing";

function widget(
	id: string,
	x: number,
	y: number,
	w: number,
	h: number,
	order?: number
): WidgetInstance {
	return {
		id,
		type: "placeholder",
		title: null,
		rect: { x, y, w, h },
		data: {},
		...(order === undefined ? {} : { minimized: { order } })
	} as unknown as WidgetInstance;
}

const tidyDoc = () => [widget("a", 0, 0, 6, 4), widget("b", 6, 0, 6, 4), widget("c", 0, 4, 12, 2)];

type SetLayout = Extract<Change, { op: "setLayout" }>;
const asLayout = (c: Change | null) => c as SetLayout;

describe("minimized order", () => {
	test("nextMinimizedOrder is one more than the highest", () => {
		expect(nextMinimizedOrder([widget("a", 0, 0, 4, 3)])).toBe(0);
		expect(nextMinimizedOrder([widget("a", 0, 0, 4, 3, 0), widget("b", 0, 0, 4, 3, 4)])).toBe(5);
	});

	test("equal orders sort by id", () => {
		const list = [
			widget("b", 0, 0, 4, 3, 1),
			widget("a", 0, 0, 4, 3, 1),
			widget("c", 0, 0, 4, 3, 0)
		];
		expect(taskbarWidgets(list).map((w) => w.id)).toEqual(["c", "a", "b"]);
	});
});

describe("minimizeChange", () => {
	test("minimize lists only the widget on a tidy layout", () => {
		const change = asLayout(minimizeChange(tidyDoc(), "a"));
		expect(change.target.widgetIds).toEqual(["a"]);
		expect(change.to.a.minimized).toEqual({ order: 0 });
		expect(change.to.a.rect).toEqual({ x: 0, y: 0, w: 6, h: 4 });
		expect(change.from.a.minimized).toBeNull();
	});

	test("minimize includes tidy fixes already due", () => {
		const change = asLayout(
			minimizeChange([widget("a", 0, 0, 6, 4), widget("b", 0, 9, 6, 2)], "a")
		);
		expect([...change.target.widgetIds].sort()).toEqual(["a", "b"]);
		expect(change.to.b.rect.y).toBe(4);
		expect(change.from.b.rect.y).toBe(9);
	});

	test("minimizes of different widgets in a tidy layout don't overlap", () => {
		const x = minimizeChange(tidyDoc(), "a")!;
		const y = minimizeChange(tidyDoc(), "b")!;
		expect(changesOverlap(x, y)).toBe(false);
	});

	test("minimizing a missing or minimized widget returns null", () => {
		const list = [widget("a", 0, 0, 6, 4), widget("m", 0, 0, 6, 4, 0)];
		expect(minimizeChange(list, "nope")).toBeNull();
		expect(minimizeChange(list, "m")).toBeNull();
	});

	test("undo of a minimize puts the widget back exactly", async () => {
		const widgets = tidyDoc();
		const platform = createMemoryPlatform();
		const doc: Dashboard = {
			kind: "dashboard",
			schemaVersion: CURRENT_SCHEMA_VERSION,
			id: "d1",
			name: null,
			version: 0,
			createdAt: "2026-10-20T00:00:00.000Z",
			updatedAt: "2026-10-20T00:00:00.000Z",
			body: { widgets }
		};
		await platform.documents.commit("anonymous", {
			docId: doc.id,
			baseVersion: null,
			doc,
			entries: []
		});
		const session = new DocumentSession({
			platform,
			space: "anonymous",
			doc,
			tabId: "tab-1"
		});
		const original = structuredClone(session.doc.body.widgets);
		session.apply(minimizeChange(session.doc.body.widgets, "a")!);
		expect(session.doc.body.widgets.find((w) => w.id === "a")?.minimized).toEqual({ order: 0 });
		session.undo();
		expect(session.doc.body.widgets).toEqual(original);
	});
});

describe("restoreChange", () => {
	test("restore places at the bottom at its saved size", () => {
		const change = asLayout(
			restoreChange([widget("b", 0, 0, 12, 3), widget("a", 6, 0, 6, 4, 0)], "a")
		);
		expect(change.target.widgetIds).toEqual(["a"]);
		expect(change.to.a).toEqual({ rect: { x: 0, y: 3, w: 6, h: 4 }, minimized: null });
		expect(change.from.a).toEqual({ rect: { x: 6, y: 0, w: 6, h: 4 }, minimized: { order: 0 } });
	});

	test("restore clamps to the type's minimum", () => {
		const change = asLayout(restoreChange([widget("a", 0, 0, 1, 1, 0)], "a"));
		expect(change.to.a.rect).toEqual({ x: 0, y: 0, w: 3, h: 2 });
	});

	test("restore includes tidy fixes already due", () => {
		const change = asLayout(
			restoreChange([widget("b", 0, 9, 6, 2), widget("a", 0, 0, 6, 4, 0)], "a")
		);
		expect([...change.target.widgetIds].sort()).toEqual(["a", "b"]);
		expect(change.to.a.rect).toEqual({ x: 0, y: 2, w: 6, h: 4 });
	});

	test("restoring a missing or unminimized widget returns null", () => {
		const list = [widget("a", 0, 0, 6, 4), widget("m", 0, 0, 6, 4, 0)];
		expect(restoreChange(list, "nope")).toBeNull();
		expect(restoreChange(list, "a")).toBeNull();
	});
});
