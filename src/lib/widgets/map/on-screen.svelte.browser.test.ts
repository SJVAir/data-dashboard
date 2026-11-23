import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryPlatform, type MemoryActivity } from "$lib/platform/memory";
import { OnScreen } from "./on-screen.svelte";

/** The observers made, each with the callback it reports through. */
let observers: { cb: IntersectionObserverCallback; options?: IntersectionObserverInit }[] = [];

class FakeObserver {
	constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
		observers.push({ cb, options });
	}
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

function intersect(on: boolean) {
	const { cb } = observers.at(-1)!;
	cb([{ isIntersecting: on } as IntersectionObserverEntry], {} as IntersectionObserver);
	flushSync();
}

let activity: MemoryActivity;
let screens: OnScreen[] = [];
const el = document.createElement("div");

function track(): OnScreen {
	const s = new OnScreen(() => el, { activity, detachDelayMs: 5000 });
	screens.push(s);
	flushSync();
	return s;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("IntersectionObserver", FakeObserver);
	observers = [];
	const platform = createMemoryPlatform();
	activity = platform.activity;
});

afterEach(() => {
	for (const s of screens) s.destroy();
	screens = [];
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("OnScreen", () => {
	it("active when visible and on screen", () => {
		const s = track();
		expect(s.active).toBe(false);
		expect(observers[0].options?.rootMargin).toBe("200px");
		intersect(true);
		expect(s.active).toBe(true);
	});

	it("stays active for the delay after leaving", () => {
		const s = track();
		intersect(true);
		intersect(false);
		vi.advanceTimersByTime(4999);
		flushSync();
		expect(s.active).toBe(true);
		// Coming back within the delay keeps it on, and the old timer no longer turns it off.
		intersect(true);
		vi.advanceTimersByTime(5000);
		flushSync();
		expect(s.active).toBe(true);
		intersect(false);
		vi.advanceTimersByTime(5000);
		flushSync();
		expect(s.active).toBe(false);
	});

	it("inactive while the page is hidden", () => {
		activity.setVisible(false);
		const s = track();
		intersect(true);
		expect(s.active).toBe(false);
		activity.setVisible(true);
		flushSync();
		expect(s.active).toBe(true);
		activity.setVisible(false);
		flushSync();
		vi.advanceTimersByTime(5000);
		flushSync();
		expect(s.active).toBe(false);
	});
});
