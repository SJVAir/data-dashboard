import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryActivity } from "../platform/memory";
import { startVersionCheck } from "./version-check";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(remote: () => Promise<string>, buildId = "abc") {
	const activity = createMemoryActivity();
	const notice = { show: vi.fn() };
	const fetchBuildId = vi.fn(remote);
	const stop = startVersionCheck({ activity, buildId, fetchBuildId, notice, intervalMs: 1000 });
	return { activity, notice, fetchBuildId, stop };
}

describe("startVersionCheck", () => {
	it("shows new-version when the tab turns visible and the id differs", async () => {
		const { activity, notice } = setup(async () => "other");
		activity.setVisible(false);
		activity.setVisible(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(notice.show).toHaveBeenCalledWith("new-version");
	});

	it("shows nothing when the id is the same", async () => {
		const { activity, notice, fetchBuildId } = setup(async () => "abc");
		activity.setVisible(false);
		activity.setVisible(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchBuildId).toHaveBeenCalledTimes(1);
		expect(notice.show).not.toHaveBeenCalled();
	});

	it("checks again after the interval while visible", async () => {
		const { fetchBuildId } = setup(async () => "abc");
		await vi.advanceTimersByTimeAsync(2500);
		expect(fetchBuildId).toHaveBeenCalledTimes(2);
	});

	it("skips the interval tick while hidden", async () => {
		const { activity, fetchBuildId } = setup(async () => "abc");
		activity.setVisible(false);
		await vi.advanceTimersByTimeAsync(3500);
		expect(fetchBuildId).not.toHaveBeenCalled();
	});

	it("shows nothing when the fetch fails", async () => {
		const { activity, notice, fetchBuildId } = setup(async () => {
			throw new Error("offline");
		});
		activity.setVisible(false);
		activity.setVisible(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchBuildId).toHaveBeenCalled();
		expect(notice.show).not.toHaveBeenCalled();
	});

	it("never fetches in dev", async () => {
		const { activity, fetchBuildId } = setup(async () => "other", "dev");
		activity.setVisible(false);
		activity.setVisible(true);
		await vi.advanceTimersByTimeAsync(5000);
		expect(fetchBuildId).not.toHaveBeenCalled();
	});

	it("stops everything when the returned function is called", async () => {
		const { activity, fetchBuildId, stop } = setup(async () => "abc");
		stop();
		activity.setVisible(false);
		activity.setVisible(true);
		await vi.advanceTimersByTimeAsync(5000);
		expect(fetchBuildId).not.toHaveBeenCalled();
	});
});
