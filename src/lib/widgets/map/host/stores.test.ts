import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryPlatform, type MemoryPlatform } from "$lib/platform/memory";
import { setPlatform } from "$lib/platform";

const created: ReturnType<typeof fakeStore>[] = [];

function fakeStore() {
	return {
		init: vi.fn(async () => {}),
		pauseAutoUpdate: vi.fn(),
		resumeAutoUpdate: vi.fn(),
		dispose: vi.fn()
	};
}

vi.mock("@sjvair/map-sdk/stores", () => ({
	createMonitorsStore: vi.fn(() => {
		const store = fakeStore();
		created.push(store);
		return store;
	})
}));

const { acquireMonitors } = await import("./stores");

let memory: MemoryPlatform;

beforeEach(() => {
	created.length = 0;
	memory = createMemoryPlatform();
	setPlatform(memory);
});

afterEach(() => vi.clearAllMocks());

describe("shared monitors stores", () => {
	it("store is shared and disposed after the last release", async () => {
		const a = acquireMonitors("pm25");
		const b = acquireMonitors("pm25");
		expect(a.store).toBe(b.store);
		expect(created).toHaveLength(1);
		expect(created[0].init).toHaveBeenCalledTimes(1);
		expect(created[0].init).toHaveBeenCalledWith("pm25");
		a.release();
		a.release();
		expect(created[0].dispose).not.toHaveBeenCalled();
		b.release();
		expect(created[0].dispose).toHaveBeenCalledTimes(1);
		const c = acquireMonitors("pm25");
		expect(created).toHaveLength(2);
		expect(c.store).not.toBe(a.store);
		c.release();
	});

	it("two entry types get two stores", () => {
		const pm = acquireMonitors("pm25");
		const o3 = acquireMonitors("o3");
		expect(pm.store).not.toBe(o3.store);
		expect(created[1].init).toHaveBeenCalledWith("o3");
		pm.release();
		expect(created[0].dispose).toHaveBeenCalled();
		expect(created[1].dispose).not.toHaveBeenCalled();
		o3.release();
	});

	it("pauses while the page is hidden and resumes", async () => {
		const handle = acquireMonitors("pm25");
		await Promise.resolve();
		const store = created[0];
		memory.activity.setVisible(false);
		expect(store.pauseAutoUpdate).toHaveBeenCalledTimes(1);
		memory.activity.setVisible(true);
		expect(store.resumeAutoUpdate).toHaveBeenCalledTimes(1);
		handle.release();
		memory.activity.setVisible(false);
		expect(store.pauseAutoUpdate).toHaveBeenCalledTimes(1);
	});

	it("starts paused when the page is hidden at acquire", async () => {
		memory.activity.setVisible(false);
		const handle = acquireMonitors("pm25");
		await vi.waitFor(() => expect(created[0].pauseAutoUpdate).toHaveBeenCalled());
		memory.activity.setVisible(true);
		expect(created[0].resumeAutoUpdate).toHaveBeenCalledTimes(1);
		handle.release();
	});
});
