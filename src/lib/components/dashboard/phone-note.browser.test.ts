import "../../../app.css";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import type { Dashboard, Rect, WidgetInstance } from "$lib/documents/schema";
import { PHONE_FIT_MAX_ROWS } from "$lib/layout/phone-fit.svelte";
import { createMemoryPlatform } from "$lib/platform/memory";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { noteType } from "$lib/widgets/notes";
import { PLACEHOLDER_TYPE } from "$lib/widgets/placeholder";
import { registerWidgetType } from "$lib/widgets/registry";
import Harness from "./test-harness/Harness.svelte";

afterEach(async () => {
	await page.viewport(1280, 800);
});

const PARAGRAPH =
	"Air quality where you are, right now and over the past month. Each tile is its own window: " +
	"move it, resize it, minimize it, or open it fullscreen, and every change saves itself.";

function note(id: string, rect: Rect, text: string): WidgetInstance {
	return { id, type: "note", title: null, rect, data: { layers: [] }, options: { text } };
}
function tile(id: string, rect: Rect): WidgetInstance {
	return { id, type: PLACEHOLDER_TYPE, title: "Next", rect, data: { layers: [] } };
}

async function seed(widgets: WidgetInstance[]) {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	registerWidgetType(noteType);
	const id = await app.index.createBlank();
	const stored = (await platform.documents.get(app.space, id)) as Dashboard;
	await platform.documents.commit(app.space, {
		docId: id,
		baseVersion: stored.version,
		doc: { ...stored, body: { widgets } },
		entries: []
	});
	const session = (await DocumentSession.open(platform, app.space, id, "t2"))!;
	app.current = { session, isStarter: false };
	await render(Harness, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	return { app, session };
}

const frame = (id: string) => page.getByTestId(`widget-${id}`).element() as HTMLElement;
const body = (id: string) => frame(id).querySelector<HTMLElement>(`[data-widget="${id}"]`)!;
const rowSpan = (id: string) => {
	const style = getComputedStyle(frame(id));
	return [style.gridRowStart, style.gridRowEnd];
};
/** The rows a frame spans ("span n"). */
const spanOf = (id: string) => Number(rowSpan(id)[1].replace("span ", ""));

test("on a phone a Note grows to show all its text, and the next widget starts below it", async () => {
	await page.viewport(390, 844);
	const { session } = await seed([
		note("n", { x: 0, y: 0, w: 12, h: 2 }, `${PARAGRAPH}\n\n${PARAGRAPH}`),
		tile("t", { x: 0, y: 2, w: 12, h: 3 })
	]);
	await expect.poll(() => body("n")?.textContent ?? "").toContain("every change saves itself");
	await expect.poll(() => Number(rowSpan("t")[0])).toBeGreaterThan(3);
	const el = body("n");
	expect(el.scrollHeight).toBeLessThanOrEqual(el.clientHeight);
	// The next widget starts where the Note ends, and doesn't overlap it.
	expect(rowSpan("n")[0]).toBe("1");
	expect(spanOf("n")).toBeGreaterThan(2);
	expect(rowSpan("t")[0]).toBe(String(1 + spanOf("n")));
	expect(frame("t").getBoundingClientRect().top).toBeGreaterThanOrEqual(
		frame("n").getBoundingClientRect().bottom
	);
	// Display only: the stored rect is unchanged.
	expect(session.doc.body.widgets.find((w) => w.id === "n")!.rect.h).toBe(2);
});

test("the Note follows its text when it changes", async () => {
	await page.viewport(390, 844);
	const { session } = await seed([
		note("n", { x: 0, y: 0, w: 12, h: 2 }, "Short."),
		tile("t", { x: 0, y: 2, w: 12, h: 3 })
	]);
	await expect.poll(() => rowSpan("t")[0]).toBe("3");
	// As the Note editor saves it.
	const widget = session.doc.body.widgets.find((w) => w.id === "n")!;
	session.apply({
		op: "setWidgetData",
		target: { widgetId: "n" },
		from: widget.data,
		to: widget.data,
		options: { from: widget.options, to: { text: [PARAGRAPH, PARAGRAPH, PARAGRAPH].join("\n\n") } }
	});
	await expect.poll(() => Number(rowSpan("t")[0])).toBeGreaterThan(3);
	const el = body("n");
	expect(el.scrollHeight).toBeLessThanOrEqual(el.clientHeight);
});

test("a very long Note stops growing at the cap and scrolls inside", async () => {
	await page.viewport(390, 844);
	await seed([
		note("n", { x: 0, y: 0, w: 12, h: 2 }, Array(20).fill(PARAGRAPH).join("\n\n")),
		tile("t", { x: 0, y: 2, w: 12, h: 3 })
	]);
	await expect.poll(() => rowSpan("t")[0]).toBe(String(PHONE_FIT_MAX_ROWS + 1));
	expect(rowSpan("n")).toEqual(["1", `span ${PHONE_FIT_MAX_ROWS}`]);
	const el = body("n");
	expect(el.scrollHeight).toBeGreaterThan(el.clientHeight);
});

test("on a desktop a Note keeps its own height", async () => {
	await page.viewport(1280, 800);
	await seed([
		note("n", { x: 0, y: 0, w: 4, h: 2 }, Array(4).fill(PARAGRAPH).join("\n\n")),
		tile("t", { x: 0, y: 2, w: 12, h: 3 })
	]);
	await expect.poll(() => body("n")?.textContent ?? "").toContain("every change saves itself");
	expect(rowSpan("n")).toEqual(["1", "span 2"]);
	expect(rowSpan("t")).toEqual(["3", "span 3"]);
	const el = body("n");
	expect(el.scrollHeight).toBeGreaterThan(el.clientHeight);
});
