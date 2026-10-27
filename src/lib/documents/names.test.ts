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
});
