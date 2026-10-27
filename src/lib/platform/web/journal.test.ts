import { expect, test } from "vitest";
import { JOURNAL_RECORD_MAX } from "../types";
import { createWebJournal } from "./journal";

/** A minimal in-memory `Storage`. */
function fakeStorage(): Storage {
	const items = new Map<string, string>();
	return {
		get length() {
			return items.size;
		},
		key: (i) => [...items.keys()][i] ?? null,
		getItem: (k) => items.get(k) ?? null,
		setItem: (k, v) => void items.set(k, v),
		removeItem: (k) => void items.delete(k),
		clear: () => items.clear()
	};
}

test("uses namespaced keys", () => {
	const storage = fakeStorage();
	createWebJournal(() => storage).write("account:7", "d1", "tab-1", { baseVersion: 1 });
	expect(storage.getItem("sjvair-workspace:journal:account:7:d1:tab-1")).toBe('{"baseVersion":1}');
});

test("an unparseable record reads back as null", () => {
	const storage = fakeStorage();
	storage.setItem("sjvair-workspace:journal:anonymous:d1:tab-1", "{nope");
	expect(createWebJournal(() => storage).readAll("anonymous", "d1")).toEqual([
		{ tabId: "tab-1", record: null }
	]);
});

test("blocked or full storage makes every call a no-op", () => {
	const blocked = createWebJournal(() => {
		throw new DOMException("blocked", "SecurityError");
	});
	expect(() => blocked.write("anonymous", "d1", "tab-1", {})).not.toThrow();
	expect(blocked.readAll("anonymous", "d1")).toEqual([]);
	expect(() => blocked.clear("anonymous", "d1", "tab-1")).not.toThrow();

	const full = fakeStorage();
	full.setItem = () => {
		throw new DOMException("full", "QuotaExceededError");
	};
	expect(() => createWebJournal(() => full).write("anonymous", "d1", "tab-1", {})).not.toThrow();
});

test("list returns every record in a space", () => {
	const journal = createWebJournal(() => fakeStorage());
	const storage = fakeStorage();
	const j = createWebJournal(() => storage);
	j.write("anonymous", "d1", "tab-1", { a: 1 });
	j.write("anonymous", "d1", "tab-2", { a: 2 });
	j.write("anonymous", "d2", "tab-1", { a: 3 });
	j.write("account:1", "d1", "tab-1", { a: 4 });
	j.write("account:12", "d9", "tab-1", { a: 5 });
	const sorted = (xs: ReturnType<typeof j.list>) =>
		xs.sort((x, y) => (x.docId + x.tabId).localeCompare(y.docId + y.tabId));
	expect(sorted(j.list("anonymous"))).toEqual([
		{ docId: "d1", tabId: "tab-1", record: { a: 1 } },
		{ docId: "d1", tabId: "tab-2", record: { a: 2 } },
		{ docId: "d2", tabId: "tab-1", record: { a: 3 } }
	]);
	expect(j.list("account:1")).toEqual([{ docId: "d1", tabId: "tab-1", record: { a: 4 } }]);
	expect(journal.list("anonymous")).toEqual([]);
});

test("a record over JOURNAL_RECORD_MAX is not written", () => {
	const storage = fakeStorage();
	const j = createWebJournal(() => storage);
	// JSON.stringify of a string adds two quote characters.
	j.write("anonymous", "d1", "tab-1", "x".repeat(JOURNAL_RECORD_MAX - 1));
	expect(j.readAll("anonymous", "d1")).toEqual([]);
	j.write("anonymous", "d1", "tab-1", "x".repeat(JOURNAL_RECORD_MAX - 2));
	expect(j.readAll("anonymous", "d1")).toHaveLength(1);
});
