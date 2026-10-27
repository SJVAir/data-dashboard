import { describe, expect, it } from "vitest";
import { ALLOWED_CONTEXT_KEYS, routePattern, scrubContext, scrubText } from "./scrub";

describe("scrubText", () => {
	it("removes emails and coordinates", () => {
		const out = scrubText("mail ana@example.org at 36.7378, -119.7871");
		expect(out).not.toContain("ana@example.org");
		expect(out).not.toContain("36.7378");
		expect(out).not.toContain("-119.7871");
		expect(out).toBe("mail [email] at [coord], [coord]");
	});

	it("removes long digit runs and UUIDs, keeping short numbers", () => {
		expect(scrubText("account 12345678 failed 3 times")).toBe("account [number] failed 3 times");
		expect(scrubText("doc 3f2a9c1e-1234-4abc-8def-123456789012 gone")).toBe("doc [id] gone");
	});
});

describe("scrubContext", () => {
	it("keeps only allowed keys", () => {
		expect(
			scrubContext({ operation: "save", name: "Ana's class", docId: "x", note: "hi" })
		).toEqual({ operation: "save" });
	});

	it("scrubs allowed string values and drops non-primitive values", () => {
		const context = { reason: "ana@example.org", status: 500, kind: { a: 1 } };
		expect(scrubContext(context as never)).toEqual({ reason: "[email]", status: 500 });
	});

	it("returns an empty object for no context", () => {
		expect(scrubContext()).toEqual({});
	});

	it("lists exactly the non-identifying keys", () => {
		expect([...ALLOWED_CONTEXT_KEYS].sort()).toEqual(
			[
				"operation",
				"schemaVersion",
				"fromSchemaVersion",
				"storeName",
				"reason",
				"directive",
				"blockedHost",
				"status",
				"kind"
			].sort()
		);
	});
});

describe("routePattern", () => {
	it("replaces ids with a pattern", () => {
		expect(routePattern("/workspace/dashboards/3f2a9c1e-1234-4abc-8def-123456789012")).toBe(
			"/dashboards/:id"
		);
	});

	it("keeps known routes and hides unknown ones", () => {
		expect(routePattern("/workspace/import")).toBe("/import");
		expect(routePattern("/workspace/")).toBe("/");
		expect(routePattern("/workspace")).toBe("/");
		expect(routePattern("/workspace/dashboards")).toBe("/dashboards");
		expect(routePattern("/workspace/dashboards/abc/widgets/x")).toBe("/other");
		expect(routePattern("/workspace/ana@example.org")).toBe("/other");
		expect(routePattern("/elsewhere")).toBe("/other");
	});
});
