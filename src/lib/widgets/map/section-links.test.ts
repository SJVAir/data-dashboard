import { describe, expect, it } from "vitest";
import { chemicalLink, sectionLinks } from "./section-links";

const LINKS = {
	links: {
		section_page: "https://x.test/tools/pesticides/sections/{id}/",
		section_records: "https://x.test/tools/pesticides/records/?section={id}",
		section_notices: "https://x.test/tools/pesticides/notices/?section={id}",
		section_notices_past: "https://x.test/tools/pesticides/notices/past/?section={id}",
		chemical_page: "https://x.test/tools/pesticides/chemicals/{id}/"
	},
	link_params: {
		section_page: [{ param: "year", from: "year" }],
		section_records: [
			{ param: "year", from: "year" },
			{ param: "start", from: "month_start" },
			{ param: "end", from: "month_end" },
			{ param: "chemical", from: "chemical_id" },
			{ param: "method", from: "aerial_ground" }
		],
		section_notices: [{ param: "chemical", from: "chemical_id" }],
		section_notices_past: [
			{ param: "y", from: "notices_year" },
			{ param: "m", from: "notices_month" }
		],
		chemical_page: [{ param: "year", from: "year" }]
	}
};
const META = LINKS as never;

describe("sectionLinks", () => {
	it("fills the templates with the year and the filters", () => {
		const links = sectionLinks(META, "s1", { year: 2023, month: null }, { chemical: "c1" }, null);
		expect(links.page).toBe("https://x.test/tools/pesticides/sections/s1/?year=2023");
		expect(links.records).toBe(
			"https://x.test/tools/pesticides/records/?section=s1&year=2023&chemical=c1"
		);
		expect(links.notices).toBe("https://x.test/tools/pesticides/notices/?section=s1&chemical=c1");
	});

	it("gives a month period its first and last Pacific day", () => {
		const links = sectionLinks(META, "s1", { year: 2024, month: 2 }, { method: "A" }, null);
		expect(links.records).toBe(
			"https://x.test/tools/pesticides/records/?section=s1&year=2024&start=2024-02-01&end=2024-02-29&method=A"
		);
	});

	it("uses the past notices link for a past day", () => {
		const links = sectionLinks(
			META,
			"s1",
			{ year: 2023, month: null },
			{},
			{ year: 2026, month: 11 }
		);
		expect(links.notices).toBe(
			"https://x.test/tools/pesticides/notices/past/?section=s1&y=2026&m=11"
		);
	});

	it("leaves out a link the meta doesn't carry, or has no params for", () => {
		const partial = {
			links: { section_page: LINKS.links.section_page },
			link_params: {}
		} as never;
		const none = sectionLinks(
			{ links: {}, link_params: {} } as never,
			"s1",
			{ year: 1, month: null },
			{},
			null
		);
		expect(none).toEqual({ page: null, records: null, notices: null });
		expect(sectionLinks(partial, "s1", { year: 1, month: null }, {}, null).page).toBeNull();
		expect(sectionLinks(undefined, "s1", { year: 1, month: null }, {}, null).page).toBeNull();
	});

	it("drops an address that isn't http(s)", () => {
		const bad = {
			links: { section_page: "javascript:alert(1)//{id}" },
			link_params: { section_page: [] }
		} as never;
		expect(sectionLinks(bad, "s1", { year: 1, month: null }, {}, null).page).toBeNull();
	});
});

describe("chemicalLink", () => {
	it("fills the chemical's page with the period, not the card's filters", () => {
		expect(chemicalLink(META, "c9", { year: 2023, month: null })).toBe(
			"https://x.test/tools/pesticides/chemicals/c9/?year=2023"
		);
		expect(chemicalLink(undefined, "c9", { year: 2023, month: null })).toBeNull();
	});
});
