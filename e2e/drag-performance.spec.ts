import type { CDPSession, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openSharedDoc, sharedDoc, titleBar, widgetTitles } from "./helpers";

// Spec 2a's target: smooth dragging with 30 placeholder widgets at 4× CPU slowdown in Chromium.
// CPU throttling is a Chromium DevTools feature, so this runs only in its own project,
// `chromium-perf` (playwright.config.ts): after the other Chromium tests and one at a time, so
// no other test competes for the CPU.
//
// "4× slowdown" has to mean the same speed on every machine, so the throttle is calibrated: a
// fixed piece of work is timed, and the rate is set so it takes TARGET_SLOWDOWN × the time it
// took on the reference machine (Linux, 32-thread desktop, headless Chromium from Playwright
// 1.64: REFERENCE_WORK_MS). On a GitHub runner, about half as fast, the rate comes out near 2.
//
// Baseline (2026-10-28, reference machine, a production build served by `vite preview`, one
// worker): six runs at 4×, each 68–73 frames, p95 16.7–16.8 ms: no frame dropped. Frame times
// come in whole vsyncs (16.7 ms), so 2× the baseline's p95, rounded up, is 34 ms: at most one
// dropped frame at the 95th percentile. (A check that the measurement sees jank: 25 ms of extra
// work per pointer move gave p95 33.3 ms, max 50 ms.) A real low-end Chromebook check before
// go-live still applies (ARCHITECTURE.md); this guards against regressions.
const P95_THRESHOLD_MS = 34;
const TARGET_SLOWDOWN = 4;
// The fixed work on the reference machine (median of 15 timings, 2026-10-28; range 9.7–10.9 ms).
// Re-measure after a Playwright (Chromium) upgrade: `timeWork(page, 9)` unthrottled, one worker.
const REFERENCE_WORK_MS = 10.3;
// How far the calibrated speed may land from the target before the check refuses to judge.
const CALIBRATION_TOLERANCE = 0.25;

const COUNT = 30;
// Three to a row, four columns by two rows each: twenty grid rows.
const DOC = sharedDoc(
	"Thirty widgets",
	Array.from({ length: COUNT }, (_, i) => `Widget ${i + 1}`),
	Array.from({ length: COUNT }, (_, i) => ({
		x: (i % 3) * 4,
		y: Math.floor(i / 3) * 2,
		w: 4,
		h: 2
	}))
);

/** The 95th percentile of `values`. */
function p95(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

/** Times a fixed piece of main-thread work in the page: the fastest of `runs`, in ms. */
async function timeWork(page: Page, runs: number): Promise<number> {
	return page.evaluate((runs) => {
		// Allocating, sorting, and building strings: the kind of work a drag does.
		const work = () => {
			let total = 0;
			for (let r = 0; r < 40; r++) {
				const items = Array.from({ length: 2000 }, (_, i) => ({
					id: `w${(i * 7919) % 2000}`,
					x: (i * 31) % 12,
					y: (i * 17) % 400
				}));
				items.sort((a, b) => a.y - b.y || a.x - b.x);
				total += items.reduce((sum, item) => sum + item.id.length + item.x, 0);
			}
			return total;
		};
		let best = Infinity;
		for (let i = 0; i < runs; i++) {
			const start = performance.now();
			work();
			best = Math.min(best, performance.now() - start);
		}
		return best;
	}, runs);
}

/**
 * Throttles the page's CPU so the fixed work takes TARGET_SLOWDOWN × REFERENCE_WORK_MS, and
 * returns the slowdown reached, relative to the reference machine.
 */
async function calibrate(page: Page, cdp: CDPSession): Promise<{ rate: number; reached: number }> {
	const target = TARGET_SLOWDOWN * REFERENCE_WORK_MS;
	// Unthrottled first; the fastest of several runs, after the JIT has warmed up.
	const unthrottled = await timeWork(page, 9);
	let rate = target / unthrottled;
	if (rate < 1) {
		throw new Error(
			`This machine is already slower than ${TARGET_SLOWDOWN}× the reference ` +
				`(${unthrottled.toFixed(1)} ms vs ${REFERENCE_WORK_MS} ms), so the check can't calibrate.`
		);
	}
	// Throttling isn't exactly linear, and one timing can land on a busy moment, so measure under
	// the throttle and correct until the work takes the target time (within 10%).
	let reached = 0;
	for (let attempt = 0; attempt < 5; attempt++) {
		await cdp.send("Emulation.setCPUThrottlingRate", { rate });
		const throttled = await timeWork(page, 5);
		reached = throttled / REFERENCE_WORK_MS;
		if (Math.abs(throttled / target - 1) < 0.1) break;
		rate = Math.max(1, rate * (target / throttled));
	}
	return { rate, reached };
}

test("dragging across thirty widgets at 4× CPU slowdown stays smooth", async ({ page }) => {
	await openSharedDoc(page, DOC);

	const cdp = await page.context().newCDPSession(page);
	const { rate, reached } = await calibrate(page, cdp);
	test.info().annotations.push({
		type: "calibration",
		description: `throttle rate ${rate.toFixed(2)}, ${reached.toFixed(2)}× the reference`
	});
	expect(
		Math.abs(reached / TARGET_SLOWDOWN - 1),
		`calibration reached ${reached.toFixed(2)}×, not ${TARGET_SLOWDOWN}×`
	).toBeLessThan(CALIBRATION_TOLERANCE);

	// Record every frame's start time from here until told to stop.
	await page.evaluate(() => {
		const w = window as unknown as { __frames: number[]; __recording: boolean };
		w.__frames = [];
		w.__recording = true;
		const tick = (t: number) => {
			w.__frames.push(t);
			if (w.__recording) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});

	// The first widget, from the top-left across the grid to the right and down: it passes over
	// many cells, so the arrangement retargets (and pushes widgets) along the way.
	const bar = await titleBar(page, "Widget 1").boundingBox();
	if (!bar) throw new Error("No title bar");
	const x = bar.x + 24;
	const y = bar.y + bar.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 700, y + 350, { steps: 60 });
	await page.mouse.up();

	const deltas = await page.evaluate(async () => {
		const w = window as unknown as { __frames: number[]; __recording: boolean };
		await new Promise((resolve) => requestAnimationFrame(resolve));
		w.__recording = false;
		const f = w.__frames;
		return f.slice(1).map((t, i) => t - f[i]);
	});
	await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

	const frameTime = p95(deltas);
	test.info().annotations.push({
		type: "drag p95",
		description: `${frameTime.toFixed(1)} ms over ${deltas.length} frames`
	});
	// The drag happened: the first widget isn't first any more.
	await expect(widgetTitles(page).first()).not.toHaveText("Widget 1");
	expect(deltas.length).toBeGreaterThan(20);
	expect(frameTime).toBeLessThan(P95_THRESHOLD_MS);
});
