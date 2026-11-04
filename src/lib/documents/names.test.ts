import { describe, expect, it } from "vitest";
import { displayNames, type DashboardSummary } from "./names";

function summary(overrides: Partial<DashboardSummary> & { id: string }): DashboardSummary {
	return {
		name: null,
		createdAt: "2026-10-20T00:00:00Z",
		updatedAt: "2026-10-20T00:00:00Z",
		...overrides
	};
}

describe("displayNames", () => {
	it("numbers generated names by creation order", () => {
		const names = displayNames(
			[
				summary({ id: "b", name: null, createdAt: "2026-10-20T02:00:00Z" }),
				summary({ id: "a", name: null, createdAt: "2026-10-20T01:00:00Z" }),
				summary({ id: "c", name: "Air at school" }),
				summary({ id: "d", name: null, copiedFrom: "starter" })
			],
			"starter"
		);
		expect(names.get("a")).toBe("Untitled dashboard");
		expect(names.get("b")).toBe("Untitled dashboard 2");
		expect(names.get("c")).toBe("Air at school");
		expect(names.get("d")).toBe("My dashboard");
	});

	it("numbers the My dashboard group separately", () => {
		const names = displayNames(
			[
				summary({ id: "x", copiedFrom: "starter", createdAt: "2026-10-20T01:00:00Z" }),
				summary({ id: "y", copiedFrom: "starter", createdAt: "2026-10-20T02:00:00Z" })
			],
			"starter"
		);
		expect(names.get("x")).toBe("My dashboard");
		expect(names.get("y")).toBe("My dashboard 2");
	});

	it("names an unnamed copy of a listed dashboard after it, and numbers several", () => {
		const list = [
			summary({ id: "mine", copiedFrom: "starter", createdAt: "2026-10-20T01:00:00Z" }),
			summary({ id: "c1", copiedFrom: "mine", createdAt: "2026-10-20T02:00:00Z" }),
			summary({ id: "c2", copiedFrom: "mine", createdAt: "2026-10-20T03:00:00Z" }),
			summary({ id: "named", name: "Trip" }),
			summary({ id: "c3", copiedFrom: "named", createdAt: "2026-10-20T04:00:00Z" })
		];
		const names = displayNames(list, "starter");
		expect(names.get("mine")).toBe("My dashboard");
		expect(names.get("c1")).toBe("Copy of My dashboard");
		expect(names.get("c2")).toBe("Copy of My dashboard 2");
		expect(names.get("c3")).toBe("Copy of Trip");
		expect(list.every((d) => d.name === null || d.id === "named")).toBe(true);
	});

	it("falls back to the Untitled rules for a missing source, itself, or a cycle", () => {
		const names = displayNames(
			[
				summary({ id: "a", copiedFrom: "gone", createdAt: "2026-10-20T01:00:00Z" }),
				summary({ id: "b", copiedFrom: "b", createdAt: "2026-10-20T02:00:00Z" }),
				summary({ id: "c", copiedFrom: "d", createdAt: "2026-10-20T03:00:00Z" }),
				summary({ id: "d", copiedFrom: "c", createdAt: "2026-10-20T04:00:00Z" })
			],
			"starter"
		);
		expect([...names.values()]).toEqual([
			"Untitled dashboard",
			"Untitled dashboard 2",
			"Untitled dashboard 3",
			"Untitled dashboard 4"
		]);
	});
});
