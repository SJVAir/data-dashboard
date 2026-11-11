import "../../../app.css";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
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
function setText(session: DocumentSession, id: string, text: string): void {
	const widget = session.doc.body.widgets.find((w) => w.id === id)!;
	session.apply({
		op: "setWidgetData",
		target: { widgetId: id },
		from: widget.data,
		to: widget.data,
		options: { from: widget.options, to: { text } }
	});
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

/** Lets ResizeObserver callbacks and their microtasks run. */
const frames = (n = 3) =>
	new Promise<void>((resolve) => {
		const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
		step(n);
	});
/** The FLIP animations (scripted ones, not CSS transitions like the pick-up ring) on frames. */
const animating = (...ids: string[]) =>
	ids.reduce(
		(sum, id) =>
			sum +
			frame(id)
				.getAnimations()
				.filter((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)).length,
		0
	);
async function focusBar(name: string) {
	const bar = page.getByRole("group", { name });
	await expect.element(bar).toBeVisible();
	(bar.element() as HTMLElement).focus();
}

test("on a desktop a Note's text changing doesn't make the next layout change jump", async () => {
	await page.viewport(1280, 800);
	const { session } = await seed([
		note("n", { x: 0, y: 0, w: 6, h: 2 }, PARAGRAPH),
		tile("t", { x: 6, y: 0, w: 6, h: 2 })
	]);
	await expect.poll(() => body("n")?.textContent ?? "").toContain("every change saves itself");
	await frames();
	// Much more text: on a phone it would need more rows.
	setText(session, "n", Array(6).fill(PARAGRAPH).join("\n\n"));
	await frames();
	// A layout change that isn't an arrangement (no pick-up first): another tab's, or an undo.
	session.apply({
		op: "setLayout",
		target: { widgetIds: ["t"] },
		from: { t: { rect: { x: 6, y: 0, w: 6, h: 2 }, minimized: null } },
		to: { t: { rect: { x: 0, y: 2, w: 6, h: 2 }, minimized: null } }
	});
	await expect.poll(() => animating("t")).toBeGreaterThan(0);
});

test("on a desktop each snap of a Note's resize animates", async () => {
	await page.viewport(1280, 800);
	await seed([note("n", { x: 0, y: 0, w: 6, h: 2 }, Array(3).fill(PARAGRAPH).join("\n\n"))]);
	await expect.poll(() => body("n")?.textContent ?? "").toContain("every change saves itself");
	await frames();
	await focusBar("Note");
	await userEvent.keyboard("{Enter}");
	for (let i = 0; i < 3; i++) {
		await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
		await expect.poll(() => animating("n")).toBeGreaterThan(0);
		for (const a of frame("n").getAnimations()) a.finish();
		// The wider text reflows (its ResizeObserver runs) before the next snap.
		await frames();
	}
	await userEvent.keyboard("{Escape}");
});

test("on a phone the text is as wide whether or not it scrolls (no flip-flop)", async () => {
	await page.viewport(390, 844);
	await seed([
		note("short", { x: 0, y: 0, w: 12, h: 2 }, "Short."),
		note("long", { x: 0, y: 2, w: 12, h: 2 }, Array(20).fill(PARAGRAPH).join("\n\n"))
	]);
	await expect.poll(() => spanOf("long")).toBe(PHONE_FIT_MAX_ROWS);
	const long = body("long");
	expect(long.scrollHeight).toBeGreaterThan(long.clientHeight);
	// The scrollbar's gutter is kept either way, so the width (and so the rows) can't flip.
	expect(long.clientWidth).toBe(body("short").clientWidth);
	expect(getComputedStyle(long).scrollbarGutter).toBe("stable");
});

test("crossing to a phone re-fits the Note, and back to a desktop it keeps its own height", async () => {
	await page.viewport(1280, 800);
	await seed([
		note("n", { x: 0, y: 0, w: 12, h: 2 }, Array(3).fill(PARAGRAPH).join("\n\n")),
		tile("t", { x: 0, y: 2, w: 12, h: 3 })
	]);
	await expect.poll(() => body("n")?.textContent ?? "").toContain("every change saves itself");
	await frames();
	expect(rowSpan("n")).toEqual(["1", "span 2"]);
	// No other trigger: only the width changes.
	await page.viewport(390, 844);
	await expect.poll(() => spanOf("n")).toBeGreaterThan(2);
	await expect.poll(() => rowSpan("t")[0]).toBe(String(1 + spanOf("n")));
	const el = body("n");
	expect(el.scrollHeight).toBeLessThanOrEqual(el.clientHeight);
	await page.viewport(1280, 800);
	await expect.poll(() => rowSpan("n")).toEqual(["1", "span 2"]);
	expect(rowSpan("t")).toEqual(["3", "span 3"]);
});

const liveText = () =>
	document.querySelector('[role="status"][aria-live="polite"][aria-atomic="true"]')?.textContent;
const announced = (text: string) => expect.poll(liveText).toBe(text);
const storedH = (session: DocumentSession, id: string) =>
	session.doc.body.widgets.find((w) => w.id === id)!.rect.h;
const rowsTall = (n: number) => `${n} ${n === 1 ? "row" : "rows"} tall.`;

/** A phone with a Note shown taller than its own height (2), and the rows it shows. */
async function grownNote() {
	await page.viewport(390, 844);
	const seeded = await seed([
		note("n", { x: 0, y: 0, w: 12, h: 2 }, `${PARAGRAPH}\n\n${PARAGRAPH}`),
		tile("t", { x: 0, y: 2, w: 12, h: 3 })
	]);
	await expect.poll(() => spanOf("n")).toBeGreaterThan(3);
	await frames();
	return { ...seeded, shown: spanOf("n") };
}

test("on a phone, Shift+Down on a grown Note grows it a row from the height shown", async () => {
	const { session, shown } = await grownNote();
	await focusBar("Note");
	await userEvent.keyboard("{Enter}");
	await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
	// The announcement says what's shown, and it shows at once.
	await announced(rowsTall(shown + 1));
	await expect.poll(() => spanOf("n")).toBe(shown + 1);
	// Nothing is written until the drop.
	expect(storedH(session, "n")).toBe(2);
	await userEvent.keyboard("{Enter}");
	await expect.poll(() => storedH(session, "n")).toBe(shown + 1);
	expect(spanOf("n")).toBe(shown + 1);
});

test("on a phone, Shift+Up on a grown Note says the height shown and doesn't raise its own", async () => {
	const { session, shown } = await grownNote();
	await focusBar("Note");
	await userEvent.keyboard("{Enter}");
	await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");
	await announced(rowsTall(shown));
	expect(spanOf("n")).toBe(shown);
	await userEvent.keyboard("{Enter}");
	await frames();
	expect(storedH(session, "n")).toBe(2);
});

test("on a phone, Size ▸ Taller on a grown Note grows it a row from the height shown", async () => {
	const { session, shown } = await grownNote();
	await page.getByRole("button", { name: "Actions for Note" }).click();
	await page.getByRole("menuitem", { name: "Size", exact: true }).click();
	await page.getByRole("menuitem", { name: "Taller", exact: true }).click();
	await expect.poll(() => storedH(session, "n")).toBe(shown + 1);
	await announced(`Resized Note to ${rowsTall(shown + 1)}`);
	await expect.poll(() => spanOf("n")).toBe(shown + 1);
	await userEvent.keyboard("{Escape}");
	await userEvent.keyboard("{Escape}");
});

function touch(el: Element, type: string, x: number, y: number) {
	const pressed = type !== "pointerup" && type !== "pointercancel";
	el.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			cancelable: true,
			composed: true,
			pointerId: 1,
			pointerType: "touch",
			isPrimary: true,
			button: type === "pointermove" ? -1 : 0,
			buttons: pressed ? 1 : 0,
			clientX: x,
			clientY: y
		})
	);
}
const center = (el: Element) => {
	const r = el.getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

test("on a phone, the touch handle grows a grown Note a row from the height shown", async () => {
	const { session, shown } = await grownNote();
	const style = getComputedStyle(frame("n").parentElement!);
	const pitch = parseFloat(style.gridAutoRows) + parseFloat(style.rowGap);
	// Lift (a long-press) and release without sliding: the touch selection, with its handle.
	const bar = page.getByRole("group", { name: "Note" }).element();
	const at = center(bar);
	touch(bar, "pointerdown", at.x, at.y);
	await new Promise((r) => setTimeout(r, 600));
	touch(bar, "pointerup", at.x, at.y);
	const done = page.getByRole("button", { name: "Done" });
	await expect.element(done).toBeVisible();
	const handle = frame("n").querySelector<HTMLElement>('[data-resize="bottom"]')!;
	const h = center(handle);
	touch(handle, "pointerdown", h.x, h.y);
	for (let i = 1; i <= 4; i++) {
		touch(handle, "pointermove", h.x, h.y + (pitch * i) / 4);
		await frames(1);
	}
	touch(handle, "pointerup", h.x, h.y + pitch);
	// One row's drag shows one row more at once; nothing is written until Done.
	await expect.poll(() => spanOf("n")).toBe(shown + 1);
	expect(storedH(session, "n")).toBe(2);
	(done.element() as HTMLElement).click();
	await expect.poll(() => storedH(session, "n")).toBe(shown + 1);
});

test("on a desktop a Note's Shift+Down still grows from its own height", async () => {
	await page.viewport(1280, 800);
	const { session } = await seed([
		note("n", { x: 0, y: 0, w: 6, h: 2 }, Array(4).fill(PARAGRAPH).join("\n\n"))
	]);
	await expect.poll(() => body("n")?.textContent ?? "").toContain("every change saves itself");
	await focusBar("Note");
	await userEvent.keyboard("{Enter}");
	await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
	await announced("6 columns wide, 3 rows tall.");
	await userEvent.keyboard("{Enter}");
	await expect.poll(() => storedH(session, "n")).toBe(3);
});
