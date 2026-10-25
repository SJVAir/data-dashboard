import { beforeEach, describe, expect, it } from "vitest";
import { loadLazy } from "./lazy";
import { updateNotice } from "./update-notice.svelte";

beforeEach(() => {
	updateNotice.reason = null;
});

describe("loadLazy", () => {
	it("shows chunk-failed and rethrows when the load rejects", async () => {
		const error = new Error("Failed to fetch dynamically imported module");
		await expect(loadLazy(() => Promise.reject(error))).rejects.toBe(error);
		expect(updateNotice.reason).toBe("chunk-failed");
	});

	it("passes a loaded module through without a notice", async () => {
		await expect(loadLazy(async () => 42)).resolves.toBe(42);
		expect(updateNotice.reason).toBeNull();
	});
});
