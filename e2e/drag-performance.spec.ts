import { expect, test } from "./fixtures";
import { openSharedDoc, sharedDoc, titleBar, widgetTitles } from "./helpers";

// Spec 2a's target: smooth dragging with 30 placeholder widgets at 4× CPU slowdown in Chromium.
// CPU throttling is a Chromium DevTools feature, so this runs there only.
//
// Baseline (2026-10-28; Linux, 32-thread desktop, headless Chromium from Playwright 1.64, a
// production build served by `vite preview`, one worker): six runs, each 68–73 frames, p95
// 16.7–16.8 ms (median 16.7, max 16.8): no frame dropped. Frame times come in whole vsyncs
// (16.7 ms), so 2× the baseline's p95, rounded up, is 34 ms: at most one dropped frame at the
// 95th percentile. (A check that the measurement sees jank: 25 ms of extra work per pointer
// move gave p95 33.3 ms, max 50 ms.) A real low-end Chromebook check before go-live still
// applies (ARCHITECTURE.md); this guards against regressions.
const P95_THRESHOLD_MS = 34;

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

test("dragging across thirty widgets at 4× CPU slowdown stays smooth", async ({
	page,
	browserName
}) => {
	test.skip(browserName !== "chromium", "CPU throttling is Chromium-only");
	await openSharedDoc(page, DOC);

	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

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
