import { describe, expect, it, vi } from "vitest";
import {
	CURRENT_SCHEMA_VERSION,
	type Dashboard,
	type Rect,
	type WidgetInstance
} from "$lib/documents/schema";
import { Arrangement, type ArrangeDirection } from "$lib/layout/arrangement.svelte";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { SpaceId } from "$lib/platform/types";
import type { AppContext } from "$lib/store/app.svelte";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { isDisabled, type MenuItem } from "./types";
import { widgetActions } from "./widget";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

const SPACE: SpaceId = "anonymous";
const CTX = { target: {} as Element, payload: {} };

function widget(id: string, rect: Rect): WidgetInstance {
	return { id, type: "placeholder", title: null, rect, data: { layers: [] } };
}

// A and B side by side, C below A.
const threeWidgets = () => [
	widget("a", { x: 0, y: 0, w: 6, h: 4 }),
	widget("b", { x: 6, y: 0, w: 6, h: 4 }),
	widget("c", { x: 0, y: 4, w: 6, h: 4 })
];

async function setup(widgets: WidgetInstance[], columns = 12, readOnly = false) {
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
	await platform.documents.commit(SPACE, { docId: doc.id, baseVersion: null, doc, entries: [] });
	const session = new DocumentSession({
		platform,
		space: SPACE,
		doc,
		tabId: "tab-1",
		...(readOnly ? { readOnly: "invalid" as const } : {})
	});
	const app = { current: { session, isStarter: false } } as unknown as AppContext;
	const arrangement = new Arrangement(
		() => session,
		() => columns
	);
	return { session, app, arrangement };
}

/** The Move or Size submenu's items for widget `id`. */
function submenu(
	app: AppContext,
	arrangement: Arrangement,
	id: string,
	which: "move-widget" | "size-widget"
): MenuItem[] {
	const items = widgetActions(app, id, arrangement)(CTX);
	return items.find((i) => i.id === which)?.children ?? [];
}

const ids = (items: MenuItem[]) => items.map((i) => i.id);
const enabled = (items: MenuItem[]) => items.filter((i) => !isDisabled(i)).map((i) => i.id);
const run = (item: MenuItem) => item.run(CTX);
const savedRects = (session: DocumentSession) =>
	Object.fromEntries(session.doc.body.widgets.map((w) => [w.id, w.rect]));

describe("Move and Size submenus", () => {
	it("offer every direction on desktop", async () => {
		const { app, arrangement } = await setup(threeWidgets());
		expect(ids(submenu(app, arrangement, "a", "move-widget"))).toEqual([
			"move-up",
			"move-down",
			"move-left",
			"move-right",
			"move-top",
			"move-bottom"
		]);
		expect(ids(submenu(app, arrangement, "a", "size-widget"))).toEqual([
			"size-wider",
			"size-narrower",
			"size-taller",
			"size-shorter"
		]);
		for (const item of submenu(app, arrangement, "a", "move-widget")) {
			expect(item.keepOpen).toBe(true);
		}
	});

	it("offer only up and down, and the height, on a phone", async () => {
		const { app, arrangement } = await setup(threeWidgets(), 1);
		expect(ids(submenu(app, arrangement, "a", "move-widget"))).toEqual([
			"move-up",
			"move-down",
			"move-top",
			"move-bottom"
		]);
		expect(ids(submenu(app, arrangement, "a", "size-widget"))).toEqual([
			"size-taller",
			"size-shorter"
		]);
	});

	it("disable the items that would change nothing", async () => {
		const { app, arrangement } = await setup([
			widget("a", { x: 0, y: 0, w: 3, h: 2 }),
			widget("b", { x: 6, y: 0, w: 6, h: 4 })
		]);
		// A is at the top-left, at its minimum size, alone in its columns.
		expect(enabled(submenu(app, arrangement, "a", "move-widget"))).toEqual(["move-right"]);
		expect(enabled(submenu(app, arrangement, "a", "size-widget"))).toEqual([
			"size-wider",
			"size-taller"
		]);
		// B touches the right edge.
		expect(enabled(submenu(app, arrangement, "b", "move-widget"))).toEqual(["move-left"]);
		expect(enabled(submenu(app, arrangement, "b", "size-widget"))).toEqual([
			"size-narrower",
			"size-taller",
			"size-shorter"
		]);
	});

	it("disable everything when the dashboard is read-only", async () => {
		const { app, arrangement } = await setup(threeWidgets(), 12, true);
		const items = widgetActions(app, "a", arrangement)(CTX);
		expect(isDisabled(items.find((i) => i.id === "move-widget")!)).toBe(true);
		expect(isDisabled(items.find((i) => i.id === "size-widget")!)).toBe(true);
		expect(enabled(submenu(app, arrangement, "a", "move-widget"))).toEqual([]);
	});

	const KEYS: Record<string, { dir: ArrangeDirection; shift: boolean }> = {
		"move-up": { dir: "up", shift: false },
		"move-down": { dir: "down", shift: false },
		"move-left": { dir: "left", shift: false },
		"move-right": { dir: "right", shift: false },
		"size-wider": { dir: "right", shift: true },
		"size-narrower": { dir: "left", shift: true },
		"size-taller": { dir: "down", shift: true },
		"size-shorter": { dir: "up", shift: true }
	};

	for (const columns of [12, 1]) {
		it(`each item is one setLayout, the same as its key and a drop (${columns} columns)`, async () => {
			for (const [itemId, key] of Object.entries(KEYS)) {
				for (const id of ["a", "b", "c"]) {
					const menu = await setup(threeWidgets(), columns);
					const which = itemId.startsWith("move") ? "move-widget" : "size-widget";
					const item = submenu(menu.app, menu.arrangement, id, which).find((i) => i.id === itemId);
					if (!item) continue; // not offered on a phone
					const keyboard = await setup(threeWidgets(), columns);
					keyboard.arrangement.pickUp(id, "move", "keyboard");
					if (key.shift) keyboard.arrangement.grow(key.dir);
					else keyboard.arrangement.step(key.dir);
					const change = keyboard.arrangement.drop();

					expect(isDisabled(item), `${itemId} on ${id}`).toBe(change === null);
					if (!change) continue;
					run(item);
					expect(savedRects(menu.session), `${itemId} on ${id}`).toEqual(
						savedRects(keyboard.session)
					);
					expect(menu.session.canUndo).toBe(true);
					menu.session.undo();
					expect(savedRects(menu.session)).toEqual(
						Object.fromEntries(threeWidgets().map((w) => [w.id, w.rect]))
					);
					expect(menu.session.canUndo).toBe(false);
				}
			}
		});
	}

	it("To top and To bottom move to the first and last places", async () => {
		const { app, arrangement, session } = await setup(threeWidgets());
		const move = () => submenu(app, arrangement, "c", "move-widget");
		run(move().find((i) => i.id === "move-top")!);
		expect(savedRects(session).c).toEqual({ x: 0, y: 0, w: 6, h: 4 });
		expect(savedRects(session).a).toEqual({ x: 0, y: 4, w: 6, h: 4 });
		expect(isDisabled(move().find((i) => i.id === "move-top")!)).toBe(true);
		run(move().find((i) => i.id === "move-bottom")!);
		expect(savedRects(session).c).toEqual({ x: 0, y: 4, w: 6, h: 4 });
		expect(isDisabled(move().find((i) => i.id === "move-bottom")!)).toBe(true);
	});

	it("To top and To bottom reorder on a phone", async () => {
		const { app, arrangement, session } = await setup(threeWidgets(), 1);
		const order = () =>
			[...session.doc.body.widgets]
				.sort((p, q) => p.rect.y - q.rect.y || p.rect.x - q.rect.x)
				.map((w) => w.id);
		run(submenu(app, arrangement, "a", "move-widget").find((i) => i.id === "move-bottom")!);
		expect(order().at(-1)).toBe("a");
		run(submenu(app, arrangement, "a", "move-widget").find((i) => i.id === "move-top")!);
		expect(order()[0]).toBe("a");
	});
});
