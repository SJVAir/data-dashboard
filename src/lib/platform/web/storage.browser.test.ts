import { beforeEach, expect, test, vi } from "vitest";
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
