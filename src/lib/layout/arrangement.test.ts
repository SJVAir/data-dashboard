import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Change } from "$lib/changes/types";
import {
	CURRENT_SCHEMA_VERSION,
	type Dashboard,
	type Rect,
	type WidgetInstance
} from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { SpaceId } from "$lib/platform/types";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { Arrangement } from "./arrangement.svelte";
import { MAX_HEIGHT } from "./config";
import * as engine from "./engine";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));
vi.mock("./engine", { spy: true });

const SPACE: SpaceId = "anonymous";

function widget(id: string, rect: Rect): WidgetInstance {
	return { id, type: "placeholder", title: null, rect, data: { layers: [] } };
}

async function setup(widgets: WidgetInstance[], columns = 12) {
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
	const session = new DocumentSession({ platform, space: SPACE, doc, tabId: "tab-1" });
	const onGone = vi.fn();
	const arrangement = new Arrangement(
		() => session,
		() => columns,
		{ onGone }
	);
	return { session, arrangement, onGone };
}

const rects = (layout: { id: string; rect: Rect }[] | null) =>
	Object.fromEntries((layout ?? []).map((i) => [i.id, i.rect]));
const savedRects = (session: DocumentSession) =>
	Object.fromEntries(session.doc.body.widgets.map((w) => [w.id, w.rect]));
const order = (layout: { id: string }[] | null) => (layout ?? []).map((i) => i.id);

// A and B side by side, C below A.
const threeWidgets = () => [
	widget("a", { x: 0, y: 0, w: 6, h: 4 }),
	widget("b", { x: 6, y: 0, w: 6, h: 4 }),
	widget("c", { x: 0, y: 4, w: 6, h: 4 })
];

describe("Arrangement", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("pickUp, moveTo, drop applies one setLayout", async () => {
		const { session, arrangement } = await setup(threeWidgets());
		const before = savedRects(session);
		arrangement.pickUp("a", "move", "pointer");
		expect(arrangement.active).toEqual({ id: "a", mode: "move", input: "pointer" });
		expect(rects(arrangement.preview)).toEqual(before);

		arrangement.moveTo({ x: 6, y: 0 });
		expect(rects(arrangement.preview)).toEqual({
			a: { x: 6, y: 0, w: 6, h: 4 },
			b: { x: 6, y: 4, w: 6, h: 4 },
			c: { x: 0, y: 0, w: 6, h: 4 }
		});
		expect(arrangement.pushedCount).toBe(2);
		expect(session.doc.body.widgets.map((w) => w.rect)).toEqual(Object.values(before));

		const change = arrangement.drop();
		expect(change?.op).toBe("setLayout");
		expect(arrangement.active).toBeNull();
		expect(arrangement.preview).toBeNull();
		expect(arrangement.pendingFocus).toBe("a");
		expect(savedRects(session)).toEqual({
			a: { x: 6, y: 0, w: 6, h: 4 },
			b: { x: 6, y: 4, w: 6, h: 4 },
			c: { x: 0, y: 0, w: 6, h: 4 }
		});
		expect(session.canUndo).toBe(true);
		session.undo();
		expect(session.canUndo).toBe(false);
		expect(savedRects(session)).toEqual(before);
	});

	it("cancel applies nothing", async () => {
		const { session, arrangement } = await setup(threeWidgets());
		const doc = session.doc;
		arrangement.pickUp("a", "move", "pointer");
		arrangement.moveTo({ x: 6, y: 0 });
		arrangement.cancel();
		expect(arrangement.active).toBeNull();
		expect(arrangement.preview).toBeNull();
		expect(session.doc).toBe(doc);
		expect(session.canUndo).toBe(false);
	});

	it("drop with no change returns null and applies nothing", async () => {
		const { session, arrangement } = await setup(threeWidgets());
		const doc = session.doc;
		arrangement.pickUp("a", "move", "keyboard");
		expect(arrangement.drop()).toBeNull();
		arrangement.pickUp("a", "move", "pointer");
		arrangement.moveTo({ x: 0, y: 0 });
		expect(arrangement.drop()).toBeNull();
		expect(session.doc).toBe(doc);
		expect(session.canUndo).toBe(false);
	});

	it("a drop that leaves the widget where it was applies nothing, even with tidying to do", async () => {
		// B is saved with a gap above it; it's shown tidied (at row 4).
		const { session, arrangement } = await setup([
			widget("a", { x: 0, y: 0, w: 6, h: 4 }),
			widget("b", { x: 0, y: 10, w: 6, h: 4 })
		]);
		const doc = session.doc;
		arrangement.pickUp("a", "move", "keyboard");
		expect(arrangement.step("right")).toBe("moved");
		expect(arrangement.step("left")).toBe("moved");
		expect(arrangement.drop()).toBeNull();
		expect(session.doc).toBe(doc);
		expect(session.canUndo).toBe(false);
		expect(arrangement.pendingFocus).toBeNull();

		// A real move still takes the tidying along.
		arrangement.pickUp("a", "move", "keyboard");
		arrangement.step("right");
		expect(arrangement.drop()?.op).toBe("setLayout");
		expect(savedRects(session).b).toEqual({ x: 0, y: 4, w: 6, h: 4 });
	});

	it("grow stops at the maximum height", async () => {
		const { arrangement } = await setup([widget("a", { x: 0, y: 0, w: 6, h: MAX_HEIGHT - 1 })]);
		arrangement.pickUp("a", "resize", "keyboard");
		arrangement.grow("down");
		arrangement.grow("down");
		arrangement.grow("down");
		expect(rects(arrangement.preview).a.h).toBe(MAX_HEIGHT);
	});

	it("a drop whose layout would break the row caps applies nothing", async () => {
		const { session, arrangement } = await setup(threeWidgets());
		const doc = session.doc;
		arrangement.pickUp("a", "resize", "pointer");
		arrangement.resizeTo({ x: 0, y: 0, w: 6, h: MAX_HEIGHT + 1 });
		expect(rects(arrangement.preview).a.h).toBe(MAX_HEIGHT + 1);
		expect(arrangement.drop()).toBeNull();
		expect(arrangement.active).toBeNull();
		expect(session.doc).toBe(doc);
		expect(session.canUndo).toBe(false);
	});

	it("step down at the bottom reports at-bottom", async () => {
		const { arrangement } = await setup([
			widget("a", { x: 0, y: 0, w: 6, h: 4 }),
			widget("b", { x: 0, y: 4, w: 6, h: 4 })
		]);
		arrangement.pickUp("a", "move", "keyboard");
		expect(arrangement.step("left")).toBe("blocked");
		expect(arrangement.step("up")).toBe("blocked");
		expect(arrangement.step("down")).toBe("moved");
		expect(rects(arrangement.preview)).toEqual({
			a: { x: 0, y: 4, w: 6, h: 4 },
			b: { x: 0, y: 0, w: 6, h: 4 }
		});
		expect(arrangement.step("down")).toBe("at-bottom");
		expect(arrangement.step("right")).toBe("moved");
		expect(rects(arrangement.preview).a).toEqual({ x: 1, y: 4, w: 6, h: 4 });
		expect(arrangement.step("up")).toBe("moved");
		expect(rects(arrangement.preview)).toEqual({
			a: { x: 1, y: 0, w: 6, h: 4 },
			b: { x: 0, y: 4, w: 6, h: 4 }
		});
	});

	const stacked = () => [
		widget("a", { x: 0, y: 0, w: 12, h: 4 }),
		widget("b", { x: 0, y: 4, w: 12, h: 4 }),
		widget("c", { x: 0, y: 8, w: 12, h: 4 })
	];

	it("each keyboard step moves one place from what's shown: Down, Down, Up", async () => {
		const { arrangement } = await setup(stacked());
		arrangement.pickUp("a", "move", "keyboard");
		expect(arrangement.step("down")).toBe("moved");
		expect(order(arrangement.preview)).toEqual(["b", "a", "c"]);
		expect(arrangement.step("down")).toBe("moved");
		expect(order(arrangement.preview)).toEqual(["b", "c", "a"]);
		expect(arrangement.step("up")).toBe("moved");
		expect(order(arrangement.preview)).toEqual(["b", "a", "c"]);
		expect(arrangement.step("up")).toBe("moved");
		expect(order(arrangement.preview)).toEqual(["a", "b", "c"]);
	});

	it("each keyboard step moves one place from what's shown: Up, Up, Down", async () => {
		const { arrangement } = await setup(stacked());
		arrangement.pickUp("c", "move", "keyboard");
		expect(arrangement.step("up")).toBe("moved");
		expect(order(arrangement.preview)).toEqual(["a", "c", "b"]);
		expect(arrangement.step("up")).toBe("moved");
		expect(order(arrangement.preview)).toEqual(["c", "a", "b"]);
		expect(arrangement.step("down")).toBe("moved");
		expect(order(arrangement.preview)).toEqual(["a", "c", "b"]);
		expect(arrangement.step("down")).toBe("moved");
		expect(order(arrangement.preview)).toEqual(["a", "b", "c"]);
		expect(arrangement.step("down")).toBe("at-bottom");
	});

	it("keyboard steps across mixed columns", async () => {
		const { arrangement } = await setup([
			widget("a", { x: 0, y: 0, w: 6, h: 4 }),
			widget("b", { x: 6, y: 0, w: 6, h: 4 }),
			widget("c", { x: 0, y: 4, w: 12, h: 4 }),
			widget("d", { x: 0, y: 8, w: 6, h: 4 })
		]);
		arrangement.pickUp("a", "move", "keyboard");
		expect(arrangement.step("down")).toBe("moved");
		expect(order(arrangement.preview)).toEqual(["b", "c", "a", "d"]);
		expect(arrangement.step("down")).toBe("moved");
		expect(order(arrangement.preview)).toEqual(["b", "c", "d", "a"]);
		expect(arrangement.step("up")).toBe("moved");
		expect(order(arrangement.preview)).toEqual(["b", "c", "a", "d"]);
		expect(arrangement.step("up")).toBe("moved");
		expect(rects(arrangement.preview)).toEqual({
			a: { x: 0, y: 0, w: 6, h: 4 },
			b: { x: 6, y: 0, w: 6, h: 4 },
			c: { x: 0, y: 4, w: 12, h: 4 },
			d: { x: 0, y: 8, w: 6, h: 4 }
		});
	});

	it("Left and Right after an Up move from the shown spot", async () => {
		const { arrangement } = await setup([
			widget("a", { x: 0, y: 0, w: 6, h: 4 }),
			widget("b", { x: 0, y: 4, w: 6, h: 4 }),
			widget("c", { x: 0, y: 8, w: 6, h: 4 })
		]);
		arrangement.pickUp("c", "move", "keyboard");
		expect(arrangement.step("up")).toBe("moved");
		expect(order(arrangement.preview)).toEqual(["a", "c", "b"]);
		expect(arrangement.step("right")).toBe("moved");
		expect(rects(arrangement.preview)).toEqual({
			a: { x: 0, y: 0, w: 6, h: 4 },
			c: { x: 1, y: 4, w: 6, h: 4 },
			b: { x: 0, y: 8, w: 6, h: 4 }
		});
		expect(arrangement.step("left")).toBe("moved");
		expect(arrangement.step("up")).toBe("moved");
		expect(order(arrangement.preview)).toEqual(["c", "a", "b"]);
		expect(arrangement.step("right")).toBe("moved");
		expect(rects(arrangement.preview)).toEqual({
			c: { x: 1, y: 0, w: 6, h: 4 },
			a: { x: 0, y: 4, w: 6, h: 4 },
			b: { x: 0, y: 8, w: 6, h: 4 }
		});
	});

	it("a keyboard step runs the engine once, however often the preview is read", async () => {
		const { arrangement } = await setup(stacked());
		arrangement.pickUp("a", "move", "keyboard");
		arrangement.step("down");
		arrangement.step("down");
		void arrangement.preview;
		const calls = vi.mocked(engine.move).mock.calls.length;
		arrangement.step("up");
		void arrangement.preview;
		void arrangement.pushedCount;
		void arrangement.preview;
		expect(engine.move).toHaveBeenCalledTimes(calls + 1);
	});

	it("pickUp and cancel clear pendingFocus", async () => {
		const { arrangement } = await setup(threeWidgets());
		arrangement.pickUp("a", "move", "pointer");
		arrangement.moveTo({ x: 6, y: 0 });
		arrangement.drop();
		expect(arrangement.pendingFocus).toBe("a");
		arrangement.pickUp("b", "move", "keyboard");
		expect(arrangement.pendingFocus).toBeNull();
		arrangement.pendingFocus = "b";
		arrangement.cancel();
		expect(arrangement.pendingFocus).toBeNull();
	});

	it("pickUp and cancel clear a pickup request", async () => {
		const { arrangement } = await setup(threeWidgets());
		arrangement.requestPickUp("a", "resize");
		expect(arrangement.pickUpRequest).toEqual({ id: "a", mode: "resize" });
		arrangement.pickUp("a", "resize", "keyboard");
		expect(arrangement.pickUpRequest).toBeNull();
		arrangement.requestPickUp("b", "move");
		arrangement.cancel();
		expect(arrangement.pickUpRequest).toBeNull();
	});

	it("step right stops at the grid's edge", async () => {
		const { arrangement } = await setup([widget("a", { x: 6, y: 0, w: 6, h: 4 })]);
		arrangement.pickUp("a", "move", "keyboard");
		expect(arrangement.step("right")).toBe("blocked");
		expect(arrangement.step("left")).toBe("moved");
		expect(rects(arrangement.preview).a).toEqual({ x: 5, y: 0, w: 6, h: 4 });
	});

	it("grow is clamped to the minimum", async () => {
		const { arrangement } = await setup([
			widget("a", { x: 0, y: 0, w: 3, h: 2 }),
			widget("b", { x: 4, y: 0, w: 3, h: 2 })
		]);
		arrangement.pickUp("a", "resize", "keyboard");
		arrangement.grow("left");
		arrangement.grow("up");
		expect(rects(arrangement.preview).a).toEqual({ x: 0, y: 0, w: 3, h: 2 });
		arrangement.grow("right");
		arrangement.grow("right");
		arrangement.grow("down");
		expect(rects(arrangement.preview)).toEqual({
			a: { x: 0, y: 0, w: 5, h: 3 },
			b: { x: 4, y: 3, w: 3, h: 2 }
		});
		expect(arrangement.pushedCount).toBe(1);
		arrangement.grow("left");
		expect(rects(arrangement.preview).a).toEqual({ x: 0, y: 0, w: 4, h: 3 });
		for (let i = 0; i < 20; i++) arrangement.grow("right");
		expect(rects(arrangement.preview).a).toEqual({ x: 0, y: 0, w: 12, h: 3 });
	});

	it("resizeTo previews the new rect", async () => {
		const { arrangement } = await setup(threeWidgets());
		arrangement.pickUp("a", "resize", "pointer");
		arrangement.resizeTo({ x: 0, y: 0, w: 8, h: 4 });
		expect(rects(arrangement.preview)).toEqual({
			a: { x: 0, y: 0, w: 8, h: 4 },
			b: { x: 6, y: 4, w: 6, h: 4 },
			c: { x: 0, y: 4, w: 6, h: 4 }
		});
	});

	it("on one column, step up/down reorders", async () => {
		const { arrangement } = await setup(
			[
				widget("a", { x: 0, y: 0, w: 6, h: 4 }),
				widget("b", { x: 6, y: 0, w: 6, h: 4 }),
				widget("c", { x: 0, y: 4, w: 12, h: 4 })
			],
			1
		);
		arrangement.pickUp("b", "move", "keyboard");
		expect(arrangement.step("left")).toBe("blocked");
		expect(arrangement.step("right")).toBe("blocked");
		expect(arrangement.step("up")).toBe("moved");
		expect(order(arrangement.preview)).toEqual(["b", "a", "c"]);
		// Still in desktop coordinates.
		expect(rects(arrangement.preview).b.w).toBe(6);
		expect(arrangement.step("up")).toBe("blocked");
		expect(arrangement.step("down")).toBe("moved");
		expect(order(arrangement.preview)).toEqual(["a", "b", "c"]);
		expect(arrangement.step("down")).toBe("moved");
		expect(order(arrangement.preview)).toEqual(["a", "c", "b"]);
		expect(arrangement.step("down")).toBe("at-bottom");

		arrangement.grow("down");
		arrangement.grow("right");
		expect(rects(arrangement.preview).b).toMatchObject({ w: 6, h: 5 });
		expect(order(arrangement.preview)).toEqual(["a", "c", "b"]);
	});

	it("moveToIndex reorders, and runs moveInOrder only when the index changes", async () => {
		const { arrangement } = await setup(threeWidgets(), 1);
		arrangement.pickUp("c", "move", "touch");
		arrangement.moveToIndex(0);
		expect(order(arrangement.preview)).toEqual(["c", "b", "a"]);
		void arrangement.preview;
		void arrangement.pushedCount;
		arrangement.moveToIndex(0);
		void arrangement.preview;
		expect(engine.moveInOrder).toHaveBeenCalledTimes(1);
		arrangement.moveToIndex(1);
		void arrangement.preview;
		arrangement.moveToIndex(0);
		void arrangement.preview;
		expect(engine.moveInOrder).toHaveBeenCalledTimes(2);
	});

	it("a pointer drag recomputes only when the target cell changes", async () => {
		const { arrangement } = await setup(threeWidgets());
		arrangement.pickUp("a", "move", "pointer");
		arrangement.moveTo({ x: 6, y: 0 });
		void arrangement.preview;
		const calls = vi.mocked(engine.move).mock.calls.length;
		arrangement.moveTo({ x: 6, y: 0 });
		void arrangement.preview;
		void arrangement.pushedCount;
		expect(engine.move).toHaveBeenCalledTimes(calls);
	});

	it("a remote change mid-drag recomputes the preview", async () => {
		const { session, arrangement } = await setup(threeWidgets());
		arrangement.pickUp("a", "move", "pointer");
		arrangement.moveTo({ x: 6, y: 0 });
		const wide: Rect = { x: 0, y: 4, w: 12, h: 4 };
		const remote: Change = {
			op: "setLayout",
			target: { widgetIds: ["c"] },
			from: { c: { rect: { x: 0, y: 4, w: 6, h: 4 }, minimized: null } },
			to: { c: { rect: wide, minimized: null } }
		};
		session.apply(remote);
		expect(arrangement.active?.id).toBe("a");
		expect(rects(arrangement.preview)).toEqual({
			a: { x: 6, y: 0, w: 6, h: 4 },
			b: { x: 6, y: 4, w: 6, h: 4 },
			c: { x: 0, y: 8, w: 12, h: 4 }
		});
		const change = arrangement.drop();
		expect(change?.op).toBe("setLayout");
		if (change?.op !== "setLayout") return;
		expect(change.from.c.rect).toEqual(wide);
		expect(savedRects(session).c).toEqual({ x: 0, y: 8, w: 12, h: 4 });
	});

	it("the dragged widget deleted elsewhere cancels", async () => {
		const { session, arrangement, onGone } = await setup(threeWidgets());
		arrangement.pickUp("a", "move", "pointer");
		arrangement.moveTo({ x: 6, y: 0 });
		const a = session.doc.body.widgets[0];
		session.apply({ op: "removeWidget", target: { widgetId: "a" }, widget: a, index: 0 });
		expect(arrangement.active).toBeNull();
		expect(arrangement.preview).toBeNull();
		expect(arrangement.pushedCount).toBe(0);
		// Node tests run Svelte's server build, where effects don't run; the next input notices.
		// (The browser test covers the effect noticing on its own.)
		arrangement.moveTo({ x: 0, y: 0 });
		expect(arrangement.drop()).toBeNull();
		expect(onGone).toHaveBeenCalledTimes(1);
		expect(onGone).toHaveBeenCalledWith("a");
		expect(session.canUndo).toBe(true);
		session.undo();
		expect(session.canUndo).toBe(false);
	});

	it("the dragged widget minimized elsewhere cancels", async () => {
		const { session, arrangement, onGone } = await setup(threeWidgets());
		arrangement.pickUp("b", "move", "keyboard");
		const rect = { x: 6, y: 0, w: 6, h: 4 };
		session.apply({
			op: "setLayout",
			target: { widgetIds: ["b"] },
			from: { b: { rect, minimized: null } },
			to: { b: { rect, minimized: { order: 0 } } }
		});
		expect(arrangement.active).toBeNull();
		expect(arrangement.step("down")).toBe("blocked");
		expect(onGone).toHaveBeenCalledExactlyOnceWith("b");
	});

	it("picking up a widget that isn't on the grid does nothing", async () => {
		const { arrangement } = await setup(threeWidgets());
		arrangement.pickUp("nope", "move", "pointer");
		expect(arrangement.active).toBeNull();
		expect(arrangement.preview).toBeNull();
	});
});
