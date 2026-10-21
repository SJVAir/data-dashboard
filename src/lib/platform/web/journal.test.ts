import { expect, test } from "vitest";
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
