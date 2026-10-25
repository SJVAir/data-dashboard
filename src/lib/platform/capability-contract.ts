import { beforeEach, describe, expect, test } from "vitest";
import type { KeptOriginal, Platform } from "./types";

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
	});
}
