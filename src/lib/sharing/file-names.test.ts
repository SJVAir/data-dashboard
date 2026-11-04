import { expect, test } from "vitest";
import { backupFileName, dashboardFileName, dataFileName } from "./file-names";

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

test("a data file's name is slugged, with the range's dates", () => {
	expect(
		dataFileName({
			entryLabel: "PM2.5",
			placeLabel: "Fresno County",
			firstDate: "2026-10-06",
			lastDate: "2026-11-04"
		})
	).toBe("pm25-fresno-county-2026-10-06-to-2026-11-04.csv");
});

test("a data file's name drops accents and punctuation", () => {
	expect(
		dataFileName({
			entryLabel: "Ozone (O₃)",
			placeLabel: "Cañada / Núñez's",
			firstDate: "2026-10-06",
			lastDate: "2026-10-06"
		})
	).toBe("ozone-o3-canada-nunezs-2026-10-06-to-2026-10-06.csv");
});

test("a data file's name falls back to data when nothing is left", () => {
	expect(
		dataFileName({
			entryLabel: "!!",
			placeLabel: "??",
			firstDate: "2026-10-06",
			lastDate: "2026-10-07"
		})
	).toBe("data-2026-10-06-to-2026-10-07.csv");
});
