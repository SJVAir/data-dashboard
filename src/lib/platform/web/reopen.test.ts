import { describe, expect, it, vi } from "vitest";
import { createReopening } from "./reopen";

const closed = () => new DOMException("The database connection is closing.", "InvalidStateError");

describe("createReopening", () => {
	it("reopens once and retries after a closed connection", async () => {
		const open = vi.fn(async () => "fresh");
		const { run } = createReopening(open, "stale");
		const result = await run(async (db) => {
			if (db === "stale") throw closed();
			return db;
		});
		expect(result).toBe("fresh");
		expect(open).toHaveBeenCalledOnce();
	});

	it("rethrows when the reopen fails", async () => {
		const failure = new Error("denied");
		const { run } = createReopening(() => Promise.reject(failure), "stale");
		await expect(run(() => Promise.reject(closed()))).rejects.toBe(failure);
	});

	it("rethrows other errors without reopening", async () => {
		const open = vi.fn(async () => "fresh");
		const { run } = createReopening(open, "stale");
		const other = new Error("boom");
		await expect(run(() => Promise.reject(other))).rejects.toBe(other);
		expect(open).not.toHaveBeenCalled();
	});

	it("never reopens after stop", async () => {
		const open = vi.fn(async () => "fresh");
		const { run, stop } = createReopening(open, "stale");
		stop();
		await expect(run(() => Promise.reject(closed()))).rejects.toBeInstanceOf(DOMException);
		expect(open).not.toHaveBeenCalled();
	});
});
