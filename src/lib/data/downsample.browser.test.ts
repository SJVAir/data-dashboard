import { describe, expect, it } from "vitest";
import { downsample } from "./downsample";
import { downsampleInWorker } from "./downsample-client";

const points = Array.from({ length: 10_000 }, (_, i) => ({
	t: Date.parse("2026-09-01T00:00:00Z") + i * 300_000,
	value: (i * 7) % 53
}));

describe("downsampleInWorker", () => {
	it("matches the main-thread result for 10 000 points", async () => {
		const openFrom = Date.parse("2026-09-20T00:00:00Z");
		const out = await downsampleInWorker(points, "hour", openFrom);
		expect(out).toEqual(downsample(points, "hour", openFrom));
	});

	it("rejects with the signal's reason when aborted", async () => {
		const controller = new AbortController();
		const promise = downsampleInWorker(points, "day", undefined, controller.signal);
		controller.abort(new Error("stop"));
		await expect(promise).rejects.toThrow("stop");
	});

	it("rejects an in-flight call on abort and keeps serving later calls", async () => {
		await downsampleInWorker(points, "day"); // warm the worker
		const controller = new AbortController();
		const promise = downsampleInWorker(points, "day", undefined, controller.signal);
		controller.abort(new Error("late"));
		await expect(promise).rejects.toThrow("late");
		expect(await downsampleInWorker(points, "day")).toEqual(downsample(points, "day"));
	});

	it("rejects at once for an already aborted signal", async () => {
		await expect(
			downsampleInWorker(points, "day", undefined, AbortSignal.abort())
		).rejects.toBeTruthy();
	});
});
