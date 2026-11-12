import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { deleteDatabase } from "./db";
import { createWebPlatform } from "./storage";
import { runCapabilityContract } from "../capability-contract";
import { runStorageContract } from "../storage-contract";

beforeEach(async () => {
	await deleteDatabase();
	localStorage.clear();
});

runStorageContract("indexeddb", () => createWebPlatform());
runCapabilityContract("indexeddb", () => createWebPlatform());

test("clearAll with several failing stores rejects once and leaves no unhandled rejection", async () => {
	const platform = await createWebPlatform();
	const unhandled: unknown[] = [];
	const listen = (event: PromiseRejectionEvent) => {
		event.preventDefault();
		unhandled.push(event.reason);
	};
	window.addEventListener("unhandledrejection", listen);
	// Aborting the transaction fails every pending clear and the transaction itself.
	const clear = IDBObjectStore.prototype.clear;
	const spy = vi.spyOn(IDBObjectStore.prototype, "clear").mockImplementation(function (
		this: IDBObjectStore
	) {
		const request = clear.call(this);
		this.transaction.abort();
		return request;
	});
	try {
		await expect(platform.reset.clearAll()).rejects.toBeDefined();
		await new Promise((resolve) => setTimeout(resolve, 50));
	} finally {
		spy.mockRestore();
		window.removeEventListener("unhandledrejection", listen);
	}
	expect(unhandled).toEqual([]);
});

describe("clearAll and MapTiler's tile cache", () => {
	afterEach(() => vi.unstubAllGlobals());

	const seed = async (platform: Awaited<ReturnType<typeof createWebPlatform>>) => {
		await platform.preferences.set("anonymous", "key", "value");
	};

	test("clearAll deletes MapTiler's tile cache", async () => {
		const del = vi.fn(async () => true);
		vi.stubGlobal("caches", { delete: del });
		const platform = await createWebPlatform();
		await platform.reset.clearAll();
		expect(del).toHaveBeenCalledWith("maptiler_sdk");
	});

	test("clearAll works where caches is missing", async () => {
		vi.stubGlobal("caches", undefined);
		const platform = await createWebPlatform();
		await seed(platform);
		await expect(platform.reset.clearAll()).resolves.toBeUndefined();
		expect(await platform.preferences.get("anonymous", "key")).toBeUndefined();
	});

	test("clearAll finishes the reset when deleting the cache fails", async () => {
		vi.stubGlobal("caches", { delete: vi.fn(() => Promise.reject(new Error("nope"))) });
		const platform = await createWebPlatform();
		await seed(platform);
		await expect(platform.reset.clearAll()).resolves.toBeUndefined();
		expect(await platform.preferences.get("anonymous", "key")).toBeUndefined();
	});
});
