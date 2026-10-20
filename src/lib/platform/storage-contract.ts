import { beforeEach, describe, expect, test } from "vitest";
import { LOG_LIMIT, type LogEntry, type Platform } from "./types";

function entry(docId: string, version: number): LogEntry {
	return {
		docId,
		version,
		change: { op: "setField", target: { path: "name" }, from: null, to: `v${version}` },
		tabId: "tab-1",
		schemaVersion: 1
	};
}

const doc = (id: string, version = 0) => ({ id, version, name: null });

export function runStorageContract(name: string, make: () => Promise<Platform>) {
	describe(`storage contract: ${name}`, () => {
		let p: Platform;
		beforeEach(async () => {
			p = await make();
		});

		test("create then get", async () => {
			const res = await p.documents.commit("anonymous", {
				docId: "a",
				baseVersion: null,
				doc: doc("a"),
				entries: []
			});
			expect(res).toEqual({ ok: true });
			expect(await p.documents.get("anonymous", "a")).toEqual(doc("a"));
			expect(await p.documents.get("anonymous", "missing")).toBeUndefined();
		});

		test("create refuses an existing id", async () => {
			const input = { docId: "a", baseVersion: null, doc: doc("a", 2), entries: [] };
			await p.documents.commit("anonymous", { ...input, doc: doc("a", 2) });
			const res = await p.documents.commit("anonymous", { ...input, doc: doc("a", 0) });
			expect(res).toEqual({ ok: false, currentVersion: 2 });
			expect(await p.documents.get("anonymous", "a")).toEqual(doc("a", 2));
		});

		test("commit with stale baseVersion is refused with currentVersion", async () => {
			await p.documents.commit("anonymous", {
				docId: "a",
				baseVersion: null,
				doc: doc("a"),
				entries: []
			});
			await p.documents.commit("anonymous", {
				docId: "a",
				baseVersion: 0,
				doc: doc("a", 1),
				entries: [entry("a", 1)]
			});
			const res = await p.documents.commit("anonymous", {
				docId: "a",
				baseVersion: 0,
				doc: doc("a", 1),
				entries: [entry("a", 1)]
			});
			expect(res).toEqual({ ok: false, currentVersion: 1 });
			expect(await p.documents.readLog("anonymous", "a", 0)).toHaveLength(1);
		});

		test("commit appends log entries readable after a version", async () => {
			await p.documents.commit("anonymous", {
				docId: "a",
				baseVersion: null,
				doc: doc("a"),
				entries: []
			});
			await p.documents.commit("anonymous", {
				docId: "a",
				baseVersion: 0,
				doc: doc("a", 2),
				entries: [entry("a", 1), entry("a", 2)]
			});
			await p.documents.commit("anonymous", {
				docId: "a",
				baseVersion: 2,
				doc: doc("a", 3),
				entries: [entry("a", 3)]
			});
			expect(await p.documents.readLog("anonymous", "a", 0)).toEqual([
				entry("a", 1),
				entry("a", 2),
				entry("a", 3)
			]);
			expect(await p.documents.readLog("anonymous", "a", 2)).toEqual([entry("a", 3)]);
			expect(await p.documents.readLog("anonymous", "a", 3)).toEqual([]);
		});

		test("log trims to 500 and reports trimmed", async () => {
			await p.documents.commit("anonymous", {
				docId: "a",
				baseVersion: null,
				doc: doc("a"),
				entries: []
			});
			const total = LOG_LIMIT + 20;
			const entries = Array.from({ length: total }, (_, i) => entry("a", i + 1));
			await p.documents.commit("anonymous", {
				docId: "a",
				baseVersion: 0,
				doc: doc("a", total),
				entries
			});
			expect(await p.documents.readLog("anonymous", "a", 0)).toBe("trimmed");
			expect(await p.documents.readLog("anonymous", "a", 19)).toBe("trimmed");
			const kept = await p.documents.readLog("anonymous", "a", 20);
			expect(kept).not.toBe("trimmed");
			expect(kept).toHaveLength(LOG_LIMIT);
			expect((kept as LogEntry[])[0].version).toBe(21);
		});

		test("spaces are isolated", async () => {
			await p.documents.commit("anonymous", {
				docId: "a",
				baseVersion: null,
				doc: { ...doc("a"), name: "anon" },
				entries: []
			});
			await p.documents.commit("account:1", {
				docId: "a",
				baseVersion: null,
				doc: { ...doc("a"), name: "acct" },
				entries: []
			});
			expect(await p.documents.get("anonymous", "a")).toMatchObject({ name: "anon" });
			expect(await p.documents.get("account:1", "a")).toMatchObject({ name: "acct" });
			await p.documents.commit("account:1", {
				docId: "a",
				baseVersion: 0,
				doc: doc("a", 1),
				entries: [entry("a", 1)]
			});
			expect(await p.documents.readLog("anonymous", "a", 0)).toEqual([]);
		});

		test("list returns only that space", async () => {
			for (const [space, id] of [
				["anonymous", "a"],
				["anonymous", "b"],
				["account:1", "c"]
			] as const) {
				await p.documents.commit(space, {
					docId: id,
					baseVersion: null,
					doc: doc(id),
					entries: []
				});
			}
			const anon = (await p.documents.list("anonymous")) as { id: string }[];
			expect(anon.map((d) => d.id).sort()).toEqual(["a", "b"]);
			const acct = (await p.documents.list("account:1")) as { id: string }[];
			expect(acct.map((d) => d.id)).toEqual(["c"]);
		});

		test("preferences round-trip per space", async () => {
			expect(await p.preferences.get("anonymous", "lastDashboard")).toBeUndefined();
			await p.preferences.set("anonymous", "lastDashboard", "d1");
			await p.preferences.set("account:1", "lastDashboard", "d2");
			expect(await p.preferences.get("anonymous", "lastDashboard")).toBe("d1");
			expect(await p.preferences.get("account:1", "lastDashboard")).toBe("d2");
			expect(await p.identity.currentSpace()).toBe("anonymous");
		});
	});
}
