import { expect, test } from "vitest";
import { backupFileName, dashboardFileName } from "./file-names";

test("a name becomes a lowercase slug with the date", () => {
	expect(dashboardFileName("Ms. Lopez's class: PM2.5!", "2026-10-25")).toBe(
		"ms-lopez-s-class-pm2-5-2026-10-25.json"
	);
});

test("a name with no letters or digits falls back to dashboard", () => {
	expect(dashboardFileName("!!! ???", "2026-10-25")).toBe("dashboard-2026-10-25.json");
	expect(dashboardFileName("", "2026-10-25")).toBe("dashboard-2026-10-25.json");
});

test("a long name's slug is at most 50 characters", () => {
	const name = dashboardFileName("a".repeat(200), "2026-10-25");
	expect(name).toBe(`${"a".repeat(50)}-2026-10-25.json`);
	expect(
		dashboardFileName("ab ".repeat(40), "2026-10-25").replace("-2026-10-25.json", "").length
	).toBeLessThanOrEqual(50);
});

test("the backup name carries the date", () => {
	expect(backupFileName("2026-10-25")).toBe("sjvair-dashboards-backup-2026-10-25.json");
});
