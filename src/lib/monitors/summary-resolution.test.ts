import { describe, expect, it } from "vitest";
import { pickSummaryResolution } from "./summary-resolution";

describe("pickSummaryResolution", () => {
	it("picks daily for a range of 45 days or fewer", () => {
		expect(pickSummaryResolution("2026-01-01", "2026-01-31")).toBe("daily");
		expect(pickSummaryResolution("2026-01-01", "2026-02-15")).toBe("daily");
	});

	it("picks monthly for a range longer than 45 days", () => {
		expect(pickSummaryResolution("2026-01-01", "2026-06-01")).toBe("monthly");
	});

	it("picks daily for a single-day range", () => {
		expect(pickSummaryResolution("2026-01-01", "2026-01-01")).toBe("daily");
	});
});
