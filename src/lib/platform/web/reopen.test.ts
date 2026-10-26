import { describe, expect, it } from "vitest";
import { createReopening, type OpenHooks } from "./reopen";

const closed = () => new DOMException("The database connection is closing.", "InvalidStateError");

/** An opener that hands out "conn1", "conn2", … and records each open's hooks. */
function opener(failFrom = Infinity) {
	const hooks: OpenHooks[] = [];
	const open = async (h: OpenHooks) => {
		hooks.push(h);
		if (hooks.length >= failFrom) throw new Error("denied");
		return `conn${hooks.length}`;
	};
	return { open, hooks };
}

describe("createReopening", () => {
	it("reopens once and retries after a closed connection", async () => {
		const { open, hooks } = opener();
		const { run } = await createReopening(open);
		const result = await run(async (db) => {
			if (db === "conn1") throw closed();
			return db;
		});
		expect(result).toBe("conn2");
		expect(hooks).toHaveLength(2);
	});

	it("rethrows when the reopen fails", async () => {
		const { open } = opener(2);
		const { run } = await createReopening(open);
		await expect(run(() => Promise.reject(closed()))).rejects.toThrow("denied");
	});

	it("rethrows other errors without reopening", async () => {
		const { open, hooks } = opener();
		const { run } = await createReopening(open);
		const other = new Error("boom");
		await expect(run(() => Promise.reject(other))).rejects.toBe(other);
		expect(hooks).toHaveLength(1);
	});

	it("never reopens after a version change on the first connection", async () => {
		const { open, hooks } = opener();
		const { run } = await createReopening(open);
		hooks[0].onVersionChange();
		await expect(run(() => Promise.reject(closed()))).rejects.toBeInstanceOf(DOMException);
		expect(hooks).toHaveLength(1);
	});

	it("never reopens after a version change on a reopened connection", async () => {
		const { open, hooks } = opener();
		const { run } = await createReopening(open);
		await run(async (db) => {
			if (db === "conn1") throw closed();
		});
		hooks[1].onVersionChange();
		await expect(run(() => Promise.reject(closed()))).rejects.toBeInstanceOf(DOMException);
		expect(hooks).toHaveLength(2);
	});
});
