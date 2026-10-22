import { describe, expect, it, vi } from "vitest";
import { downsample } from "./downsample";
import { downsampleInWorker } from "./downsample-client";

/** Holds posted requests so a test can abort while one is in flight, then releases them. */
function holdPosts() {
	const original = Worker.prototype.postMessage;
	const held: Array<[unknown, Worker]> = [];
	const spy = vi.spyOn(Worker.prototype, "postMessage").mockImplementation(function (
		this: Worker,
		message: unknown
	) {
		held.push([message, this]);
	});
	return {
		held,
		release: () => held.forEach(([message, w]) => original.call(w, message)),
		restore: () => spy.mockRestore()
	};
}

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

	it("rejects an in-flight call on abort, ignores its late reply, and keeps serving", async () => {
		await downsampleInWorker(points, "day"); // warm the worker
		const posts = holdPosts();
		try {
			const controller = new AbortController();
			const promise = downsampleInWorker(points, "day", undefined, controller.signal);
			promise.catch(() => {});
			// Abort only once the request has really been posted to the worker.
			await vi.waitFor(() => expect(posts.held).toHaveLength(1));
			controller.abort(new Error("late"));
			await expect(promise).rejects.toThrow("late");
			// The worker still answers the aborted request; that late reply must be ignored.
			posts.release();
			posts.restore();
			await new Promise((r) => setTimeout(r, 50));
			expect(await downsampleInWorker(points, "hour")).toEqual(downsample(points, "hour"));
		} finally {
			posts.restore();
		}
	});

	it("rejects an in-flight call with an AbortError when aborted without a reason", async () => {
		await downsampleInWorker(points, "day");
		const posts = holdPosts();
		try {
			const controller = new AbortController();
			const promise = downsampleInWorker(points, "day", undefined, controller.signal);
			promise.catch(() => {});
			await vi.waitFor(() => expect(posts.held).toHaveLength(1));
			controller.abort();
			await expect(promise).rejects.toMatchObject({ name: "AbortError" });
		} finally {
			posts.restore();
		}
	});

	it("rejects at once for an already aborted signal", async () => {
		await expect(
			downsampleInWorker(points, "day", undefined, AbortSignal.abort())
		).rejects.toMatchObject({ name: "AbortError" });
	});
});
