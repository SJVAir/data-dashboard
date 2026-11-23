import "../../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { mapType } from "$lib/widgets/map";
import { placeholderType } from "$lib/widgets/placeholder";
import { registerWidgetType } from "$lib/widgets/registry";
import Harness from "./test-harness/Harness.svelte";

// A type whose code waits for its frame to near the screen (the Map's opt-in, D20), with a spy
// on its load. A fresh descriptor per test: loaded code is cached per descriptor.
const NEAR = "load-when-near-test";
const AT_ONCE = "load-at-once-test";
function registerTypes() {
	const near = {
		...placeholderType,
		type: NEAR,
		loadWhenNear: true,
		load: vi.fn(placeholderType.load)
	};
	const atOnce = { ...placeholderType, type: AT_ONCE, load: vi.fn(placeholderType.load) };
	registerWidgetType(near);
	registerWidgetType(atOnce);
	return { near: near.load, atOnce: atOnce.load };
}

const originalUrl = location.href;
beforeEach(async () => {
	await page.viewport(1280, 800);
	window.scrollTo(0, 0);
	history.replaceState(null, "", "/workspace/shared/tok");
});
afterEach(() => {
	history.replaceState(null, "", originalUrl);
	vi.unstubAllGlobals();
});

/** A tall widget at the top (30 rows, ~2400 px), and one of `type` below it, far off screen. */
function doc(type: string, topType = AT_ONCE): Dashboard {
	const w = (id: string, t: string, y: number, h: number): WidgetInstance => ({
		id,
		type: t,
		title: id === "top" ? "Top" : "Far",
		rect: { x: 0, y, w: 6, h },
		data: { layers: [] }
	});
	return {
		kind: "dashboard",
		schemaVersion: 1,
		id: "shared-1",
		name: "Class dashboard",
		version: 3,
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-01T00:00:00.000Z",
		body: { widgets: [w("top", topType, 0, 30), w("far", type, 30, 4)] }
	};
}

async function renderView(type: string, topType?: string) {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	const screen = await render(Harness, {
		props: { view: doc(type, topType) },
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
	await expect.element(page.getByTestId("widget-far")).toBeInTheDocument();
	return screen;
}

const far = () => document.querySelector<HTMLElement>('[data-testid="widget-far"]')!;
/** A couple of frames, for an observer that would fire to have fired. */
const frames = async () => {
	for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
};
/** Scroll so the far frame's top is `gap` px below the viewport's bottom. */
function scrollToGap(gap: number) {
	const top = far().getBoundingClientRect().top + window.scrollY;
	window.scrollTo(0, top - window.innerHeight - gap);
}

test("the Map opts in", () => {
	expect(mapType.loadWhenNear).toBe(true);
});

test("a frame far below the screen doesn't load its code until it's within 200 px", async () => {
	const { near, atOnce } = registerTypes();
	await renderView(NEAR);
	await expect.poll(() => atOnce.mock.calls.length).toBe(1);
	await frames();
	expect(near).not.toHaveBeenCalled();
	scrollToGap(300);
	await frames();
	expect(near).not.toHaveBeenCalled();
	scrollToGap(100);
	await expect.poll(() => near.mock.calls.length).toBe(1);
	// Never goes back: scrolled away, it stays.
	window.scrollTo(0, 0);
	await frames();
	expect(far().querySelector('[data-widget="far"]')).not.toBeNull();
});

test("focus moving into the frame loads its code", async () => {
	const { near } = registerTypes();
	await renderView(NEAR);
	await frames();
	expect(near).not.toHaveBeenCalled();
	// Without scrolling it into view, so only the focus can load it.
	far()
		.querySelector<HTMLElement>('button[aria-label="Show Far fullscreen"]')!
		.focus({ preventScroll: true });
	await expect.poll(() => near.mock.calls.length).toBe(1);
});

test("a fullscreen frame loads its code at once", async () => {
	const { near } = registerTypes();
	history.replaceState(null, "", "/workspace/shared/tok?widget=far");
	await renderView(NEAR);
	await expect.poll(() => near.mock.calls.length).toBe(1);
});

test("once its code has loaded, a frame mounted off screen shows at once", async () => {
	const { near } = registerTypes();
	// One frame near the screen (at the top) loads the code.
	const first = await renderView(AT_ONCE, NEAR);
	await expect.poll(() => near.mock.calls.length).toBe(1);
	await expect.poll(() => document.querySelector('[data-widget="top"]')).not.toBeNull();
	first.unmount();
	// A second, far below the screen, doesn't wait to be scrolled near.
	await renderView(NEAR);
	await expect.poll(() => far().querySelector('[data-widget="far"]')).not.toBeNull();
	expect(far().getBoundingClientRect().top).toBeGreaterThan(window.innerHeight + 200);
	expect(near).toHaveBeenCalledTimes(1);
});

test("a type that doesn't opt in loads at once, off screen", async () => {
	registerTypes();
	await renderView(AT_ONCE);
	await expect.poll(() => far().querySelector('[data-widget="far"]')).not.toBeNull();
	expect(far().getBoundingClientRect().top).toBeGreaterThan(window.innerHeight + 200);
});

test("with no IntersectionObserver, the code loads at once", async () => {
	vi.stubGlobal("IntersectionObserver", undefined);
	const { near } = registerTypes();
	await renderView(NEAR);
	await expect.poll(() => near.mock.calls.length).toBe(1);
});
