import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@sjvair/sdk")>()),
	getPesticidesMeta: vi.fn(),
	getPesticideSectionDetails: vi.fn()
}));

vi.mock("@sjvair/map-sdk", async (importOriginal) => {
	const sdk = await importOriginal<typeof import("@sjvair/map-sdk")>();
	const { createFakeLens } = await import("./test-harness/fake-map.svelte");
	const plugin = (kind: string) => (options: { id?: string }) => ({
		id: options.id ?? kind,
		kind,
		options
	});
	return { ...sdk, shapesPlugin: plugin("shapes"), shapesLens: createFakeLens };
});

import axe from "axe-core";
import { getPesticideSectionDetails, getPesticidesMeta } from "@sjvair/sdk";
import type { CardContext, FeatureListItem, MapContext } from "@sjvair/map-sdk";
import { createRawSnippet, type Snippet } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { render } from "vitest-browser-svelte";
import "../../../app.css";
import { resetPesticideMeta } from "$lib/data/pesticide-meta";
import { formatMonthName, formatValue } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import { resetSectionDetails, sectionDetail } from "./data/section-detail";
import type { UseProps, UseQuery } from "./data/use";
import type { UsePeriod } from "./use-period";
import { buildUseScale } from "./data/use-scale";
import UseLayers from "./layers/UseLayers.svelte";
import SectionCard from "./SectionCard.svelte";
import RenderSnippet from "./test-harness/RenderSnippet.svelte";
import { FakeMap, fakeLenses } from "./test-harness/fake-map.svelte";

const FIGURES = [
	{ id: "pounds-applied", label: "Pounds Applied", units: "lbs", precision: 0 },
	{ id: "acres-treated", label: "Acres Treated", units: "acres", precision: 1 },
	{ id: "applications", label: "Applications", units: "applications", precision: 0 }
];
const PERIOD = { year: 2023, month: null };
const SCALE = buildUseScale(
	{ breaks: [10, 100, 1000], min: null, colors: ["#111", "#222", "#333"] },
	{ label: "Pounds Applied", units: "lbs", precision: 0 }
);

const META = {
	categories: [],
	iarc_groups: [],
	methods: [],
	narrows: [],
	placeholder_chemicals: [],
	// The meta's order, which the card keeps whatever order a chemical lists them in.
	badges: [
		{ key: "prop65", label: "Prop 65", note: null },
		{ key: "iarc_2b", label: "IARC 2B", note: null },
		{ key: "tac", label: "Toxic air contaminant", note: null }
	],
	notes: {},
	links: {} as Record<string, string>,
	link_params: {} as Record<string, { param: string; from: string }[]>,
	notice_filters: []
};

const LINKED = {
	...META,
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
			{ param: "chemical", from: "chemical_id" }
		],
		section_notices: [{ param: "chemical", from: "chemical_id" }],
		section_notices_past: [
			{ param: "y", from: "notices_year" },
			{ param: "m", from: "notices_month" }
		],
		chemical_page: [{ param: "year", from: "year" }]
	}
};

const LBS = [0, 10, 40, 300, 120, 0, 0, 0, 0, 0, 0, 5];

function detail(over: { months?: number[]; year?: number } = {}) {
	const lbs = over.months ?? LBS;
	return {
		id: "s1",
		mtrs: "MDM-T15S-R20E-01",
		county: "Fresno",
		year: over.year ?? 2023,
		geometry: null,
		years: [],
		months: lbs.map((v, i) => ({
			month: i + 1,
			lbs_chemical: v,
			acres_treated: v / 10,
			applications: v > 0 ? 1 : 0
		})),
		top_chemicals: [
			{ id: "c1", name: "A", display_name: "Sulfur", lbs: 100, is_of_concern: false, badges: [] },
			{
				id: "c2",
				name: "B",
				display_name: "1,3-Dichloropropene",
				lbs: 300,
				is_of_concern: true,
				badges: ["tac", "prop65"]
			},
			{
				id: "c3",
				name: "C",
				display_name: "Glyphosate",
				lbs: 50,
				is_of_concern: false,
				badges: []
			},
			{ id: "c4", name: "D", display_name: "Copper", lbs: 10, is_of_concern: false, badges: [] }
		],
		top_products: [],
		top_commodities: []
	};
}

function section(over: Partial<UseProps> = {}): UseProps {
	return {
		refKey: "feature:section:s1",
		name: "MDM-T15S-R20E-01",
		value: 475,
		level: "section",
		id: "s1",
		county: "Fresno",
		township: "MDM-T15S-R20E",
		lbs_chemical: 475,
		acres_treated: 47.5,
		applications: 5,
		...over
	};
}

const focusables = (root: Element) =>
	root.querySelectorAll("button, a[href], input, select, textarea, [tabindex]");

function card(over: Record<string, unknown> = {}) {
	return render(SectionCard, {
		// The cards have a `props` prop, so the mount options are spelled out.
		props: {
			props: section(),
			figure: "pounds-applied",
			figures: FIGURES,
			period: PERIOD,
			scale: SCALE,
			filtersLine: null,
			filters: {},
			noticesDay: null,
			townshipLine: null,
			interactive: true,
			...over
		}
	});
}

const monthName = (month: number) => formatMonthName(`2023-${String(month).padStart(2, "0")}-01`);

beforeEach(() => {
	vi.resetAllMocks();
	resetPesticideMeta();
	resetSectionDetails();
	vi.mocked(getPesticidesMeta).mockResolvedValue(META as never);
	vi.mocked(getPesticideSectionDetails).mockResolvedValue(detail() as never);
});

describe("SectionCard", () => {
	it("shows the MTRS code, county, filters and its figures with the class", async () => {
		const screen = await card({ filtersLine: "Sulfur" });
		await expect.element(screen.getByRole("heading", { name: "MDM-T15S-R20E-01" })).toBeVisible();
		await expect.element(screen.getByText("Fresno")).toBeVisible();
		await expect
			.element(screen.getByText(m.map_use_legend_filters({ filters: "Sulfur" })))
			.toBeVisible();
		await expect
			.element(
				screen.getByText(
					m.map_use_card_class({ tier: "3", count: "3", range: "100 to 1,000", units: "lbs" })
				)
			)
			.toBeVisible();
		const text = screen.container.textContent ?? "";
		expect(text).toContain(m.map_use_card_value({ value: formatValue(47.5, 1), units: "acres" }));
	});

	it("the section card shows 12 bars with a text list, the peak month, and badges as text", async () => {
		const screen = await card();
		await expect
			.element(screen.getByText(m.map_use_card_peak({ month: monthName(4) })))
			.toBeVisible();
		const bars = screen.container.querySelectorAll("[data-use-bar]");
		expect(bars).toHaveLength(12);
		// The tallest month fills the chart; an empty month draws no bar.
		expect((bars[3] as HTMLElement).style.height).toBe("100%");
		expect((bars[0] as HTMLElement).style.height).toBe("0%");
		// The text alternative: every month and its value.
		const rows = [...screen.container.querySelectorAll("[data-use-months] li")].map((li) =>
			li.textContent?.trim()
		);
		expect(rows).toHaveLength(12);
		expect(rows[3]).toBe(
			m.map_use_card_month_row({
				month: monthName(4),
				value: formatValue(300, 0),
				units: "lbs"
			})
		);
		// The top three by pounds, each with its badges in the meta's order, as text.
		const chemicals = [...screen.container.querySelectorAll("[data-use-chemical]")];
		expect(chemicals.map((c) => c.getAttribute("data-use-chemical"))).toEqual(["c2", "c1", "c3"]);
		const badges = [...chemicals[0].querySelectorAll("[data-use-badge]")].map((b) => b.textContent);
		expect(badges).toEqual(["Prop 65", "Toxic air contaminant"]);
		// Outlined chips, not colour alone.
		expect(chemicals[0].querySelector("[data-use-badge]")!.className).toContain("border");
	});

	it("the bars follow the shown figure", async () => {
		const screen = await card({ figure: "applications", props: section({ value: 5 }) });
		await expect
			.element(screen.getByText(m.map_use_card_peak({ month: monthName(2) })))
			.toBeVisible();
	});

	it("peaks in is left out when every month is zero", async () => {
		vi.mocked(getPesticideSectionDetails).mockResolvedValue(
			detail({ months: Array(12).fill(0) }) as never
		);
		const screen = await card();
		await expect.poll(() => screen.container.querySelectorAll("[data-use-bar]").length).toBe(12);
		expect(screen.container.textContent).not.toContain(
			m.map_use_card_peak({ month: monthName(1) }).replace(monthName(1), "")
		);
	});

	it("the hover form has nothing focusable, and fetches nothing", async () => {
		const screen = await card({ interactive: false });
		await expect.element(screen.getByText("MDM-T15S-R20E-01")).toBeVisible();
		expect(focusables(screen.container)).toHaveLength(0);
		expect(screen.container.querySelector("[data-use-bar]")).toBeNull();
		expect(getPesticideSectionDetails).not.toHaveBeenCalled();
	});

	it("a failed detail shows a line with Retry, which asks again", async () => {
		vi.mocked(getPesticideSectionDetails).mockRejectedValueOnce(new Error("down"));
		const screen = await card();
		await expect.element(screen.getByText(m.map_use_card_detail_failed())).toBeVisible();
		await screen.getByRole("button", { name: m.widget_state_retry() }).click();
		await expect
			.element(screen.getByText(m.map_use_card_peak({ month: monthName(4) })))
			.toBeVisible();
		expect(getPesticideSectionDetails).toHaveBeenCalledTimes(2);
	});

	it("has no axe violations, in both forms", async () => {
		for (const interactive of [true, false]) {
			const screen = await card({ interactive, filtersLine: "Sulfur" });
			if (interactive)
				await expect
					.poll(() => screen.container.querySelectorAll("[data-use-bar]").length)
					.toBe(12);
			const results = await axe.run(screen.container);
			expect(results.violations.map((v) => [v.id, v.nodes.map((n) => n.html)])).toEqual([]);
			screen.unmount();
		}
	});
});

describe("sectionDetail", () => {
	it("the section detail is fetched once per section and year", async () => {
		const a = await card();
		const b = await card();
		await expect.poll(() => a.container.querySelectorAll("[data-use-bar]").length).toBe(12);
		await expect.poll(() => b.container.querySelectorAll("[data-use-bar]").length).toBe(12);
		expect(getPesticideSectionDetails).toHaveBeenCalledTimes(1);
		await sectionDetail("s1", { year: 2022, filters: {} });
		expect(getPesticideSectionDetails).toHaveBeenCalledTimes(2);
		expect(vi.mocked(getPesticideSectionDetails).mock.calls.map((c) => [c[0], c[1]])).toEqual([
			["s1", { year: 2023 }],
			["s1", { year: 2022 }]
		]);
	});

	it("a failed request is dropped, and a caller's abort stops only its own wait", async () => {
		vi.mocked(getPesticideSectionDetails).mockRejectedValueOnce(new Error("down"));
		await expect(sectionDetail("s1", { year: 2023, filters: {} })).rejects.toThrow("down");
		const controller = new AbortController();
		const aborted = sectionDetail("s1", { year: 2023, filters: {} }, controller.signal);
		const other = sectionDetail("s1", { year: 2023, filters: {} });
		controller.abort();
		await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
		await expect(other).resolves.toMatchObject({ id: "s1" });
		expect(getPesticideSectionDetails).toHaveBeenCalledTimes(2);
	});

	it("the section detail is asked with the Map's filters and month, and keyed by them", async () => {
		const filters = { chemical: "c1", method: "A", category: ["b", "a"], iarcGroup: "2B" };
		await sectionDetail("s1", { year: 2023, month: 6, filters });
		expect(getPesticideSectionDetails).toHaveBeenLastCalledWith("s1", {
			year: 2023,
			month: 6,
			chemical_id: "c1",
			aerial_ground: "A",
			category: ["b", "a"],
			iarc_group: "2B"
		});
		// The same ask again (the category list in another order) shares the request.
		await sectionDetail("s1", {
			year: 2023,
			month: 6,
			filters: { ...filters, category: ["a", "b"] }
		});
		expect(getPesticideSectionDetails).toHaveBeenCalledTimes(1);
		// Another filter, month, or none is another request; a year has no month key.
		await sectionDetail("s1", { year: 2023, month: 7, filters });
		await sectionDetail("s1", { year: 2023, filters: { chemical: "c2" } });
		await sectionDetail("s1", { year: 2023, month: null, filters: {} });
		expect(getPesticideSectionDetails).toHaveBeenCalledTimes(4);
		expect(vi.mocked(getPesticideSectionDetails).mock.calls.at(-1)).toEqual(["s1", { year: 2023 }]);
	});

	it("the detail cache keeps a few entries, dropping the oldest", async () => {
		for (let i = 0; i < 80; i++) await sectionDetail(`s${i}`, { year: 2023, filters: {} });
		expect(getPesticideSectionDetails).toHaveBeenCalledTimes(80);
		await sectionDetail("s79", { year: 2023, filters: {} });
		expect(getPesticideSectionDetails).toHaveBeenCalledTimes(80);
		await sectionDetail("s0", { year: 2023, filters: {} });
		expect(getPesticideSectionDetails).toHaveBeenCalledTimes(81);
	});
});

describe("the section card's links", () => {
	/** The href of the link whose text holds `label` (the cue adds its own screen reader text). */
	const hrefOf = (root: Element, label: string) =>
		[...root.querySelectorAll("a[href]")]
			.find((a) => a.textContent?.includes(label))
			?.getAttribute("href");

	it("come from the meta templates, open in a new tab with the cue and rel", async () => {
		vi.mocked(getPesticidesMeta).mockResolvedValue(LINKED as never);
		const screen = await card({ filters: { chemical: "c1" } });
		await expect
			.poll(() => screen.container.querySelectorAll("a[href]").length)
			.toBeGreaterThanOrEqual(3);
		const links = [...screen.container.querySelectorAll("a[href]")];
		for (const a of links) {
			expect(a.getAttribute("target")).toBe("_blank");
			expect(a.getAttribute("rel")).toBe("noopener noreferrer");
			expect(a.querySelector("svg")).not.toBeNull();
		}
		expect(hrefOf(screen.container, m.map_use_card_link_section())).toBe(
			"https://x.test/tools/pesticides/sections/s1/?year=2023"
		);
		expect(hrefOf(screen.container, m.map_use_card_link_records())).toBe(
			"https://x.test/tools/pesticides/records/?section=s1&year=2023&chemical=c1"
		);
		expect(hrefOf(screen.container, m.map_use_card_link_notices())).toBe(
			"https://x.test/tools/pesticides/notices/?section=s1&chemical=c1"
		);
	});

	it("a missing meta link is left out", async () => {
		vi.mocked(getPesticidesMeta).mockResolvedValue({
			...LINKED,
			links: { section_page: LINKED.links.section_page }
		} as never);
		const screen = await card();
		await expect
			.element(screen.getByRole("link", { name: new RegExp(m.map_use_card_link_section()) }))
			.toBeVisible();
		expect(screen.container.querySelectorAll("a[href]")).toHaveLength(1);
		screen.unmount();
		// A meta with no links at all (an old server) leaves the card as it was.
		vi.mocked(getPesticidesMeta).mockResolvedValue({ ...LINKED, links: undefined } as never);
		resetPesticideMeta();
		const bare = await card();
		await expect.poll(() => bare.container.querySelectorAll("[data-use-bar]").length).toBe(12);
		expect(bare.container.querySelectorAll("a[href]")).toHaveLength(0);
	});

	it("each top chemical's name links to its chemical page", async () => {
		vi.mocked(getPesticidesMeta).mockResolvedValue(LINKED as never);
		const screen = await card({ filters: { chemical: "c1" } });
		await expect
			.poll(() => screen.container.querySelectorAll("[data-use-chemical] a").length)
			.toBe(3);
		const link = screen.container.querySelector('[data-use-chemical="c2"] a')!;
		expect(link.textContent).toContain("1,3-Dichloropropene");
		expect(link.getAttribute("href")).toBe(
			"https://x.test/tools/pesticides/chemicals/c2/?year=2023"
		);
	});

	it("Notices here links to the explorer's notices for the section, with no list", async () => {
		vi.mocked(getPesticidesMeta).mockResolvedValue(LINKED as never);
		const screen = await card();
		const link = screen.getByRole("link", { name: new RegExp(m.map_use_card_link_notices()) });
		await expect.element(link).toBeVisible();
		expect(screen.container.querySelector("[data-use-notices]")).toBeNull();
		await expect
			.element(link)
			.toHaveAttribute("href", "https://x.test/tools/pesticides/notices/?section=s1");
		// Only the chemicals are listed; the card holds no notices.
		expect(screen.container.querySelectorAll("[data-use-chemical]")).toHaveLength(3);
	});

	it("Notices here is the explorer's past link on a past day", async () => {
		vi.mocked(getPesticidesMeta).mockResolvedValue(LINKED as never);
		const screen = await card({ noticesDay: { year: 2026, month: 11 } });
		await expect
			.element(screen.getByRole("link", { name: new RegExp(m.map_use_card_link_notices()) }))
			.toHaveAttribute(
				"href",
				"https://x.test/tools/pesticides/notices/past/?section=s1&y=2026&m=11"
			);
	});

	it("the links show while the detail loads and when it fails", async () => {
		vi.mocked(getPesticidesMeta).mockResolvedValue(LINKED as never);
		vi.mocked(getPesticideSectionDetails).mockRejectedValueOnce(new Error("down"));
		const screen = await card();
		await expect.element(screen.getByText(m.map_use_card_detail_failed())).toBeVisible();
		await expect
			.poll(() => hrefOf(screen.container, m.map_use_card_link_notices()))
			.toBe("https://x.test/tools/pesticides/notices/?section=s1");
		expect(hrefOf(screen.container, m.map_use_card_link_section())).toBeTruthy();
	});

	it("the hover form has no links", async () => {
		vi.mocked(getPesticidesMeta).mockResolvedValue(LINKED as never);
		const screen = await card({ interactive: false });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(screen.container.querySelectorAll("a[href]")).toHaveLength(0);
	});
});

describe("a section's card on the map", () => {
	type Tooltip = (item: FeatureListItem, props: UseProps, env: unknown) => Snippet | undefined;
	/** A data source holding `features`, reactively (as the use block's sources are). */
	const source = (features: UseProps[]) => {
		const held = new SvelteMap([[0, features]]);
		return {
			status: { state: "ready" },
			get features() {
				return {
					type: "FeatureCollection",
					features: held.get(0)!.map((properties) => ({
						type: "Feature",
						geometry: { type: "Point", coordinates: [0, 0] },
						properties
					}))
				};
			},
			scale: null,
			set: (next: UseProps[]) => held.set(0, next)
		};
	};

	/**
	 * The `id` plugin's card for the section, as map-sdk asks for it: pinned, keyboard-focused
	 * (the feature list), or hovered (neither).
	 */
	async function tooltipOf(
		id: "lens" | "sections",
		form: "pinned" | "focused" | "hovered",
		filters: UseQuery["filters"] = {},
		period: UsePeriod = PERIOD
	) {
		const map = new FakeMap();
		map.addPlugin({ id: "focus", kind: "focus", options: {} });
		const sections = source([section()]);
		await render(UseLayers, {
			map: map as unknown as MapContext,
			townships: source([]) as never,
			sections: sections as never,
			lensSource: source([section()]) as never,
			block: () => [],
			parentOf: () => null,
			label: "Pounds Applied, 2023",
			units: "lbs",
			zoom: 12,
			queryKey: "q",
			query: { figure: "pounds-applied", period, filters, info: FIGURES[0] },
			noticesDay: null,
			figures: FIGURES,
			drawn: true,
			loads: true,
			note: createRawSnippet(() => ({ render: () => "<p></p>" })),
			onlens: () => {}
		});
		await expect.poll(() => map.plugins.some((p) => p.id === id)).toBe(true);
		const refKey = section().refKey;
		if (form === "pinned") map.pinned = { hit: { pluginId: id, refKey, name: section().name } };
		if (form === "focused") map.focusedKey = refKey;
		const tooltip = map.plugins.find((p) => p.id === id)!.options.tooltip as Tooltip;
		const item = { refKey, name: section().name } as FeatureListItem;
		return { snippet: tooltip(item, section(), { scale: SCALE })!, sections };
	}

	for (const id of ["lens", "sections"] as const) {
		it(`a pinned section from the ${id} shows its months and chemicals`, async () => {
			const { snippet } = await tooltipOf(id, "pinned");
			const screen = await render(RenderSnippet, { snippet });
			await expect
				.element(screen.getByText(m.map_use_card_peak({ month: monthName(4) })))
				.toBeVisible();
			expect(screen.container.querySelectorAll("[data-use-chemical]")).toHaveLength(3);
			expect(getPesticideSectionDetails).toHaveBeenCalledWith("s1", { year: 2023 });
		});
	}

	it("a pinned section asks for its details with the Map's filters and month", async () => {
		const { snippet } = await tooltipOf(
			"sections",
			"pinned",
			{ chemical: "c1" },
			{ year: 2023, month: 6 }
		);
		await render(RenderSnippet, { snippet });
		await expect
			.poll(() => vi.mocked(getPesticideSectionDetails).mock.calls.at(-1))
			.toEqual(["s1", { year: 2023, month: 6, chemical_id: "c1" }]);
	});

	it("a keyboard-focused section gets the interactive form", async () => {
		const { snippet } = await tooltipOf("sections", "focused");
		const screen = await render(RenderSnippet, { snippet });
		await expect.element(screen.getByRole("group", { name: section().name })).toBeVisible();
		await expect
			.element(screen.getByText(m.map_use_card_peak({ month: monthName(4) })))
			.toBeVisible();
	});

	for (const id of ["lens", "sections"] as const) {
		it(`a hovered section from the ${id} fetches nothing`, async () => {
			const { snippet } = await tooltipOf(id, "hovered");
			const screen = await render(RenderSnippet, { snippet });
			await expect.element(screen.getByText(section().name)).toBeVisible();
			expect(focusables(screen.container)).toHaveLength(0);
			// Give a fetch the chance to start.
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(getPesticideSectionDetails).not.toHaveBeenCalled();
			expect(getPesticidesMeta).not.toHaveBeenCalled();
		});
	}

	it("a map refetch with the same section doesn't ask for its details again after a failure", async () => {
		vi.mocked(getPesticideSectionDetails).mockRejectedValueOnce(new Error("down"));
		const { snippet, sections } = await tooltipOf("sections", "pinned");
		const screen = await render(RenderSnippet, { snippet });
		await expect.element(screen.getByText(m.map_use_card_detail_failed())).toBeVisible();
		// The refetch: new properties for the same section.
		sections.set([section({ lbs_chemical: 600, value: 600 })]);
		await expect
			.element(screen.getByText(m.map_use_card_value({ value: formatValue(600, 0), units: "lbs" })))
			.toBeVisible();
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(getPesticideSectionDetails).toHaveBeenCalledTimes(1);
		await expect.element(screen.getByText(m.map_use_card_detail_failed())).toBeVisible();
	});
});

describe("the section card's township line", () => {
	const TOWNSHIP_REF = "feature:township:MDM-T15S-R20E";
	const township = (over: Partial<UseProps> = {}): UseProps => ({
		refKey: TOWNSHIP_REF,
		name: "MDM-T15S-R20E",
		value: 1234,
		level: "township",
		id: "MDM-T15S-R20E",
		county: null,
		township: "MDM-T15S-R20E",
		sections: 36,
		lbs_chemical: 1234,
		acres_treated: 120.5,
		applications: 12,
		...over
	});
	const sourceOf = (features: UseProps[]) => ({
		status: { state: "ready" },
		features: {
			type: "FeatureCollection",
			features: features.map((properties) => ({
				type: "Feature",
				geometry: { type: "Point", coordinates: [0, 0] },
				properties
			}))
		},
		scale: null
	});
	const LINE = m.map_use_card_in_township({
		township: "MDM-T15S-R20E",
		value: formatValue(1234, 0),
		units: "lbs"
	});

	/** UseLayers on a fake map with one township and its section, and the card actions it gives. */
	async function layers(townships: UseProps[] = [township()]) {
		const map = new FakeMap();
		map.addPlugin({ id: "focus", kind: "focus", options: {} });
		let actions: Snippet<[CardContext]> | null = null;
		await render(UseLayers, {
			map: map as unknown as MapContext,
			townships: sourceOf(townships) as never,
			sections: sourceOf([section()]) as never,
			lensSource: sourceOf([section()]) as never,
			block: () => [],
			parentOf: (props: UseProps) => (props.level === "section" ? TOWNSHIP_REF : null),
			label: "Pounds Applied, 2023",
			units: "lbs",
			zoom: 12,
			queryKey: "q",
			query: { figure: "pounds-applied", period: PERIOD, filters: {}, info: FIGURES[0] },
			noticesDay: null,
			figures: FIGURES,
			drawn: true,
			loads: true,
			note: createRawSnippet(() => ({ render: () => "<p></p>" })),
			onlens: () => {},
			oncardactions: (snippet: Snippet<[CardContext]> | null) => (actions = snippet)
		});
		await expect.poll(() => map.plugins.some((p) => p.id === "lens")).toBe(true);
		await expect.poll(() => actions).not.toBeNull();
		return { map, actions: actions! };
	}

	/** The card actions for a section pinned from `pluginId`, as map-sdk renders them. */
	function contextOf(map: FakeMap, pluginId: string, refKey = section().refKey): CardContext {
		map.pinned = { hit: { pluginId, refKey, name: section().name } };
		return {
			pluginId,
			ref: { kind: "feature", id: refKey.slice("feature:".length) },
			refKey,
			item: { refKey, name: section().name } as FeatureListItem,
			selectable: false,
			selected: false,
			toggle: () => {}
		};
	}

	it("the section card names its township and figure", async () => {
		const { map, actions } = await layers();
		for (const id of ["lens", "sections"]) {
			const screen = await render(RenderSnippet, {
				snippet: actions,
				card: contextOf(map, id)
			});
			await expect.element(screen.getByRole("button", { name: LINE })).toBeVisible();
			screen.unmount();
		}
	});

	it("the township button opens the township card in place, the lens still held, the camera unmoved", async () => {
		const { map, actions } = await layers();
		const lens = fakeLenses.at(-1)!;
		lens.pin(TOWNSHIP_REF);
		const screen = await render(RenderSnippet, { snippet: actions, card: contextOf(map, "lens") });
		await screen.getByRole("button", { name: LINE }).click();
		expect(map.pinCalls).toEqual([["townships", TOWNSHIP_REF]]);
		expect(map.pinned?.hit).toMatchObject({ pluginId: "townships", refKey: TOWNSHIP_REF });
		expect(lens.pinned).toBe(true);
		expect(lens.center).toBe(TOWNSHIP_REF);
		expect(map.cameraCalls).toEqual([]);
	});

	it("the township's figure comes from the loaded townships; without it the line has no figure", async () => {
		const { map, actions } = await layers([]);
		const screen = await render(RenderSnippet, {
			snippet: actions,
			card: contextOf(map, "sections")
		});
		const bare = m.map_use_card_in_township_no_figure({ township: "MDM-T15S-R20E" });
		// Not loaded, it can't be pinned: the line is text.
		await expect.element(screen.getByText(bare)).toBeVisible();
		expect(focusables(screen.container)).toHaveLength(0);
		expect(map.pinCalls).toEqual([]);
	});

	it("a township's card and other plugins' cards get no line", async () => {
		const { map, actions } = await layers();
		for (const [id, refKey] of [
			["townships", TOWNSHIP_REF],
			["monitors", "monitor:a"]
		]) {
			const screen = await render(RenderSnippet, {
				snippet: actions,
				card: contextOf(map, id, refKey)
			});
			expect(screen.container.textContent?.trim()).toBe("");
			screen.unmount();
		}
	});

	it("on hover the line is text, not a button", async () => {
		const { map } = await layers();
		const tooltip = map.plugins.find((p) => p.id === "lens")!.options.tooltip as (
			item: FeatureListItem,
			props: UseProps,
			env: unknown
		) => Snippet;
		const item = { refKey: section().refKey, name: section().name } as FeatureListItem;
		const screen = await render(RenderSnippet, { snippet: tooltip(item, section(), {}) });
		await expect.element(screen.getByText(LINE)).toBeVisible();
		expect(focusables(screen.container)).toHaveLength(0);
		screen.unmount();
		// The interactive card leaves the line to its actions (one line, a button).
		map.pinned = { hit: { pluginId: "lens", refKey: section().refKey, name: section().name } };
		const pinned = await render(RenderSnippet, { snippet: tooltip(item, section(), {}) });
		await expect.element(pinned.getByRole("heading", { name: section().name })).toBeVisible();
		expect(pinned.container.textContent).not.toContain(LINE);
	});
});
