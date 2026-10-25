import { describe, expect, it } from "vitest";
import { pendingName } from "./journal";

const name = (to: string | null) => ({
	op: "setField",
	target: { path: "name" },
	from: null,
	to
});

const rec = (writtenAt: string, ...changes: unknown[]) => ({
	record: { baseVersion: 1, changes, schemaVersion: 1, writtenAt }
});

describe("pendingName", () => {
	it("is undefined with no records or no name change", () => {
		expect(pendingName([])).toBeUndefined();
		const widget = { op: "setField", target: { widgetId: "w", path: "title" }, from: "a", to: "b" };
		expect(pendingName([rec("2026-10-20T00:00:00Z", widget)])).toBeUndefined();
	});

	it("is the last name change in a record", () => {
		expect(pendingName([rec("2026-10-20T00:00:00Z", name("A"), name("B"))])).toBe("B");
	});

	it("can be null (the name was cleared)", () => {
		expect(pendingName([rec("2026-10-20T00:00:00Z", name(null))])).toBeNull();
	});

	it("reads the newest valid record, ignoring invalid ones", () => {
		expect(
			pendingName([
				rec("2026-10-20T00:00:00Z", name("Older")),
				{ record: { nonsense: true } },
				rec("2026-10-21T00:00:00Z", name("Newest")),
				{ record: "bad" }
			])
		).toBe("Newest");
	});
});
