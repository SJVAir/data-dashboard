import { beforeEach, describe, expect, test } from "vitest";
import type { KeptOriginal, LogEntry, Platform } from "./types";

const original = (id: string, raw: unknown = { id }): KeptOriginal => ({
	id,
	raw,
	keptAt: "2026-10-25T00:00:00.000Z",
	fromSchemaVersion: 1
});

export function runCapabilityContract(name: string, make: () => Promise<Platform>) {
	describe(`capability contract: ${name}`, () => {
		let p: Platform;
		beforeEach(async () => {
			p = await make();
		});

		test("originals round-trip as clones", async () => {
			const raw = { id: "a", nested: { n: 1 } };
			const kept = original("a", raw);
			await p.originals.put("anonymous", kept);
			raw.nested.n = 2;
			const got = await p.originals.get("anonymous", "a");
			expect(got).toEqual(original("a", { id: "a", nested: { n: 1 } }));
			expect(await p.originals.get("anonymous", "missing")).toBeUndefined();
		});

		test("put replaces an existing original", async () => {
			await p.originals.put("anonymous", original("a", { v: 1 }));
			await p.originals.put("anonymous", original("a", { v: 2 }));
			expect(await p.originals.get("anonymous", "a")).toEqual(original("a", { v: 2 }));
			expect(await p.originals.list("anonymous")).toHaveLength(1);
		});

		test("list is per space", async () => {
			await p.originals.put("anonymous", original("a"));
			await p.originals.put("anonymous", original("b"));
			await p.originals.put("account:1", original("c"));
			const anon = await p.originals.list("anonymous");
			expect(anon.map((o) => o.id).sort()).toEqual(["a", "b"]);
			expect((await p.originals.list("account:1")).map((o) => o.id)).toEqual(["c"]);
		});

		test("remove deletes only that original", async () => {
			await p.originals.put("anonymous", original("a"));
			await p.originals.put("anonymous", original("b"));
			await p.originals.remove("anonymous", "a");
			expect(await p.originals.get("anonymous", "a")).toBeUndefined();
			expect(await p.originals.get("anonymous", "b")).toBeDefined();
			await expect(p.originals.remove("anonymous", "missing")).resolves.toBeUndefined();
		});

		test("clearAll removes documents, logs, originals, preferences, and journal records in every space and changes the generation", async () => {
			const before = p.reset.generation();
			for (const space of ["anonymous", "account:x"] as const) {
				const doc = { id: "d", version: 1 };
				await p.documents.commit(space, {
					docId: "d",
					baseVersion: null,
					doc,
					entries: [
						{
							docId: "d",
							version: 1,
							change: { type: "noop" } as unknown as LogEntry["change"],
							tabId: "t",
							schemaVersion: 1
						}
					]
				});
				await p.originals.put(space, original("d"));
				await p.preferences.set(space, "k", 1);
				p.journal.write(space, "d", "t", { n: 1 });
			}
			await p.reset.clearAll();
			for (const space of ["anonymous", "account:x"] as const) {
				expect(await p.documents.list(space)).toEqual([]);
				expect(await p.documents.get(space, "d")).toBeUndefined();
				expect(await p.documents.readLog(space, "d", 0)).toEqual([]);
				expect(await p.originals.list(space)).toEqual([]);
				expect(await p.preferences.get(space, "k")).toBeUndefined();
				expect(p.journal.readAll(space, "d")).toEqual([]);
				expect(p.journal.list(space)).toEqual([]);
			}
			expect(p.reset.generation()).not.toBe(before);
		});

		test("generation is stable between calls", () => {
			expect(p.reset.generation()).toBe(p.reset.generation());
		});

		test("run is exclusive per name", async () => {
			const log: string[] = [];
			const gate = Promise.withResolvers<void>();
			const first = p.locks.run("a", async () => {
				log.push("first start");
				await gate.promise;
				log.push("first end");
				return 1;
			});
			const second = p.locks.run("a", async () => {
				log.push("second start");
				return 2;
			});
			const other = await p.locks.run("b", async () => {
				log.push("other");
				return 3;
			});
			expect(other).toBe(3);
			await new Promise((r) => setTimeout(r, 20));
			expect(log).toEqual(["first start", "other"]);
			gate.resolve();
			expect(await Promise.all([first, second])).toEqual([1, 2]);
			expect(log).toEqual(["first start", "other", "first end", "second start"]);
		});

		test("run rethrows and releases", async () => {
			await expect(
				p.locks.run("a", async () => {
					throw new Error("boom");
				})
			).rejects.toThrow("boom");
			expect(await p.locks.run("a", async () => "ok")).toBe("ok");
		});

		test("hold is granted in turn and released on abort", async () => {
			const a = new AbortController();
			const b = new AbortController();
			const log: string[] = [];
			const heldA = p.locks.hold("h", a.signal, () => log.push("a"));
			const heldB = p.locks.hold("h", b.signal, () => log.push("b"));
			await new Promise((r) => setTimeout(r, 20));
			expect(log).toEqual(["a"]);
			a.abort();
			await heldA;
			await new Promise((r) => setTimeout(r, 20));
			expect(log).toEqual(["a", "b"]);
			b.abort();
			await heldB;
		});

		test("an aborted waiter is never granted", async () => {
			const a = new AbortController();
			const b = new AbortController();
			const log: string[] = [];
			const heldA = p.locks.hold("w", a.signal, () => log.push("a"));
			const heldB = p.locks.hold("w", b.signal, () => log.push("b"));
			await new Promise((r) => setTimeout(r, 20));
			b.abort();
			await heldB;
			a.abort();
			await heldA;
			await new Promise((r) => setTimeout(r, 20));
			expect(log).toEqual(["a"]);
			expect(await p.locks.run("w", async () => "free")).toBe("free");
		});
	});
}
