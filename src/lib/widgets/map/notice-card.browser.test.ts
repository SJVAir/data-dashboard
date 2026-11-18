import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@sjvair/sdk")>()),
	getPesticidesMeta: vi.fn()
}));

import axe from "axe-core";
import { getPesticidesMeta } from "@sjvair/sdk";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import "../../../app.css";
import { resetPesticideMeta } from "$lib/data/pesticide-meta";
import { formatDate, formatDateTime, formatNumber } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import type { NoticeItem } from "./data/notices";
import NoticeCard from "./NoticeCard.svelte";

const SIGNUP = "https://spraydays.example/signup";
const SOURCE = "https://cdpr.example/noi";

/** The pesticides meta, with the explainer and the SprayDays link (the server's English). */
const META = {
	categories: [],
	iarc_groups: [],
	methods: [
		{ key: "G", label: "Ground" },
		{ key: "F", label: "Field fumigation" }
	],
	narrows: [],
	placeholder_chemicals: [],
	badges: [],
	notes: {
		noi_meaning: {
			key: "noi_meaning",
			title: "What a notice means",
			summary: "A plan to apply, not proof it happened. Restricted materials only.",
			detail: null,
			source_url: SOURCE
		}
	},
	links: { spraydays_signup: SIGNUP },
	notice_filters: []
};

function notice(over: Partial<NoticeItem> = {}): NoticeItem {
	return {
		id: "n1",
		scheduled: "2026-11-14T09:30:00-08:00",
		scheduledEnd: "2026-11-18T09:30:00-08:00",
		method: "Fumigation",
		methodKey: "F",
		amount: 12.5,
		units: "A",
		county: "Fresno",
		section: "M15S20E01",
		sectionId: "s1",
		coordinates: [-119.5, 36.5],
		products: [{ id: "p1", name: "Telone II" }],
		chemicals: [
			{ id: "c1", name: "1,3-Dichloropropene", ofConcern: true },
			{ id: "c2", name: "Water", ofConcern: false }
		],
		...over
	};
}

const at = (iso: string) => formatDateTime(new Date(iso));

async function setup(props: {
	notices: NoticeItem[];
	section?: string | null;
	county?: string | null;
	onNow?: boolean;
	now?: () => Date;
	interactive?: boolean;
}) {
	return render(NoticeCard, {
		section: "M15S20E01",
		county: "Fresno",
		onNow: true,
		now: () => new Date("2026-11-15T12:00:00-08:00"),
		...props
	});
}

beforeEach(() => {
	vi.resetAllMocks();
	resetPesticideMeta();
	vi.mocked(getPesticidesMeta).mockResolvedValue(META as never);
});

describe("NoticeCard", () => {
	it("one notice shows its dates, amount, method, products and chemicals", async () => {
		const screen = await setup({ notices: [notice()] });
		await expect.element(screen.getByText(at("2026-11-14T09:30:00-08:00"))).toBeVisible();
		await expect
			.element(screen.getByText(m.map_notice_through({ date: at("2026-11-18T09:30:00-08:00") })))
			.toBeVisible();
		await expect
			.element(screen.getByText(m.map_notice_where({ section: "M15S20E01", county: "Fresno" })))
			.toBeVisible();
		await expect
			.element(screen.getByText(m.map_notice_amount({ amount: formatNumber(12.5), units: "A" })))
			.toBeVisible();
		// The meta's label for the notice's method key.
		await expect
			.element(screen.getByText(m.map_notice_method({ method: "Field fumigation" })))
			.toBeVisible();
		await expect.element(screen.getByText(m.map_notice_products())).toBeVisible();
		await expect.element(screen.getByText("Telone II")).toBeVisible();
		await expect.element(screen.getByText(m.map_notice_chemicals())).toBeVisible();
		await expect.element(screen.getByText("1,3-Dichloropropene")).toBeVisible();
		await expect.element(screen.getByText("Water")).toBeVisible();
		// Products come before chemicals.
		const text = screen.container.textContent ?? "";
		expect(text.indexOf("Telone II")).toBeLessThan(text.indexOf("1,3-Dichloropropene"));
		// The explainer, as text.
		await expect.element(screen.getByText(META.notes.noi_meaning.summary)).toBeVisible();
	});

	it("leaves out the method and the units when the notice has none", async () => {
		// No wording is the `none` key, which the meta doesn't list.
		const screen = await setup({
			notices: [notice({ method: "", methodKey: "none", units: "", amount: 3 })]
		});
		await expect
			.element(screen.getByText(m.map_notice_amount_no_units({ amount: formatNumber(3) })))
			.toBeVisible();
		await new Promise((r) => setTimeout(r, 50));
		expect(screen.container.textContent).not.toContain(m.map_notice_method({ method: "" }));
	});

	it("the method label comes from the meta by key, with the wording only as a fallback", async () => {
		const labelled = await setup({ notices: [notice({ methodKey: "G", method: "Ground rig" })] });
		await expect
			.element(labelled.getByText(m.map_notice_method({ method: "Ground" })))
			.toBeVisible();
		expect(labelled.container.textContent).not.toContain("Ground rig");
		labelled.unmount();
		// A key the meta doesn't list (`O`, `none`): SprayDays' wording.
		const unlisted = await setup({ notices: [notice({ methodKey: "O", method: "Chemigation" })] });
		await expect
			.element(unlisted.getByText(m.map_notice_method({ method: "Chemigation" })))
			.toBeVisible();
		unlisted.unmount();
		// Before the meta loads: the wording, then the label.
		let resolve!: (value: unknown) => void;
		resetPesticideMeta();
		vi.mocked(getPesticidesMeta).mockReturnValue(new Promise((r) => (resolve = r)) as never);
		const waiting = await setup({ notices: [notice()] });
		await expect
			.element(waiting.getByText(m.map_notice_method({ method: "Fumigation" })))
			.toBeVisible();
		resolve(META);
		await expect
			.element(waiting.getByText(m.map_notice_method({ method: "Field fumigation" })))
			.toBeVisible();
	});

	it("names the place by whole-sentence variants when the server leaves part out", async () => {
		const one = await setup({ notices: [notice()], section: null });
		await expect
			.element(one.getByText(m.map_notice_where_county({ county: "Fresno" })))
			.toBeVisible();
		one.unmount();
		const two = await setup({ notices: [notice()], county: null });
		await expect
			.element(two.getByText(m.map_notice_where_section({ section: "M15S20E01" })))
			.toBeVisible();
		two.unmount();
		const three = await setup({ notices: [notice()], section: null, county: null });
		await expect.element(three.getByText(m.map_notice_where_no_place())).toBeVisible();
	});

	it("tags an active notice on now, never on a past day", async () => {
		const active = await setup({ notices: [notice()] });
		await expect.element(active.getByText(m.map_notice_active())).toBeVisible();
		active.unmount();
		const before = await setup({
			notices: [notice()],
			now: () => new Date("2026-11-14T09:00:00-08:00")
		});
		await expect.element(before.getByText(at("2026-11-14T09:30:00-08:00"))).toBeVisible();
		expect(before.container.textContent).not.toContain(m.map_notice_active());
		before.unmount();
		const day = await setup({ notices: [notice()], onNow: false });
		await expect.element(day.getByText(at("2026-11-14T09:30:00-08:00"))).toBeVisible();
		expect(day.container.textContent).not.toContain(m.map_notice_active());
	});

	it("of concern is said in text, not colour alone", async () => {
		const screen = await setup({ notices: [notice()] });
		await expect.element(screen.getByText("1,3-Dichloropropene")).toBeVisible();
		const items = screen.getByRole("listitem").elements();
		const text = (name: string) => items.find((li) => li.textContent?.includes(name))?.textContent;
		expect(text("1,3-Dichloropropene")).toContain(m.map_notice_of_concern());
		expect(text("Water")).not.toContain(m.map_notice_of_concern());
		// The marker beside the words is hidden from screen readers (the words say it).
		const marker = items.find((li) => li.textContent?.includes("1,3"))?.querySelector("svg");
		expect(marker?.getAttribute("aria-hidden")).toBe("true");
	});

	it("an empty chemical list reads None listed", async () => {
		const screen = await setup({ notices: [notice({ chemicals: [], products: [] })] });
		await expect.poll(() => screen.getByText(m.map_notice_none_listed()).elements().length).toBe(2);
	});

	it("list card order", async () => {
		const screen = await setup({
			notices: [
				notice({ id: "b", scheduled: "2026-11-14T09:30:00-08:00" }),
				notice({ id: "c", scheduled: "2026-11-15T07:00:00-08:00" }),
				notice({ id: "a", scheduled: "2026-11-12T06:00:00-08:00" })
			]
		});
		await expect
			.element(screen.getByText(m.map_notice_list_heading({ count: "3", countValue: 3 })))
			.toBeVisible();
		const rows = screen
			.getByRole("button")
			.filter({ hasText: m.map_notice_method({ method: "Field fumigation" }) });
		await expect.poll(() => rows.elements().length).toBe(3);
		const texts = rows.elements().map((row) => row.textContent ?? "");
		expect(texts[0]).toContain(at("2026-11-12T06:00:00-08:00"));
		expect(texts[1]).toContain(at("2026-11-14T09:30:00-08:00"));
		expect(texts[2]).toContain(at("2026-11-15T07:00:00-08:00"));
	});

	it("a list row opens that notice, and Back returns focus to its row", async () => {
		const screen = await setup({
			notices: [
				notice({ id: "a", scheduled: "2026-11-12T06:00:00-08:00" }),
				notice({
					id: "b",
					scheduled: "2026-11-14T09:30:00-08:00",
					products: [{ id: "p2", name: "Vapam" }]
				})
			]
		});
		const second = screen.getByRole("button", {
			name: new RegExp(at("2026-11-14T09:30:00-08:00"))
		});
		await second.click();
		await expect.element(screen.getByText("Vapam")).toBeVisible();
		const back = screen.getByRole("button", {
			name: m.map_notice_back({ count: "2", countValue: 2 })
		});
		// Focus moves into the detail, not lost with the row.
		await expect.element(back).toHaveFocus();
		await userEvent.keyboard("{Enter}");
		await expect
			.element(screen.getByRole("button", { name: new RegExp(at("2026-11-14T09:30:00-08:00")) }))
			.toHaveFocus();
		expect(screen.container.textContent).not.toContain("Vapam");
	});

	it("a refetch that removes the focused list row moves focus to the card, not body", async () => {
		const row = (id: string, iso: string) => notice({ id, scheduled: iso });
		const screen = await setup({
			notices: [
				row("a", "2026-11-12T06:00:00-08:00"),
				row("b", "2026-11-14T09:30:00-08:00"),
				row("c", "2026-11-15T07:00:00-08:00")
			]
		});
		const card = () => screen.container.querySelector("[data-notice-card]")!;
		const rowOf = (iso: string) => screen.getByRole("button", { name: new RegExp(at(iso)) });
		// A removed row, with the list still there: focus goes to the list's first row.
		(rowOf("2026-11-14T09:30:00-08:00").element() as HTMLElement).focus();
		await screen.rerender({
			notices: [row("a", "2026-11-12T06:00:00-08:00"), row("c", "2026-11-15T07:00:00-08:00")]
		});
		await expect
			.poll(() => document.activeElement)
			.toBe(rowOf("2026-11-12T06:00:00-08:00").element());
		// The list collapses to one notice (its detail, no rows): focus goes to the card.
		await screen.rerender({ notices: [row("c", "2026-11-15T07:00:00-08:00")] });
		await expect.poll(() => screen.container.querySelectorAll("li button").length).toBe(0);
		await expect.poll(() => document.activeElement).toBe(card());
		expect(document.activeElement).not.toBe(document.body);
	});

	it("a refetch that keeps the focused row leaves focus on it", async () => {
		const row = (id: string, iso: string) => notice({ id, scheduled: iso });
		const screen = await setup({
			notices: [row("a", "2026-11-12T06:00:00-08:00"), row("b", "2026-11-14T09:30:00-08:00")]
		});
		const second = screen.getByRole("button", {
			name: new RegExp(at("2026-11-14T09:30:00-08:00"))
		});
		(second.element() as HTMLElement).focus();
		await screen.rerender({
			notices: [
				row("a", "2026-11-12T06:00:00-08:00"),
				row("b", "2026-11-14T09:30:00-08:00"),
				row("d", "2026-11-16T07:00:00-08:00")
			]
		});
		await expect.poll(() => screen.container.querySelectorAll("li button").length).toBe(3);
		expect(document.activeElement).toBe(second.element());
	});

	it("the SprayDays link comes from the meta and opens in a new tab with rel noopener", async () => {
		const screen = await setup({ notices: [notice()] });
		const link = screen.getByRole("link", {
			name: `${m.map_notice_spraydays()} ${m.opens_in_new_tab()}`
		});
		await expect.element(link).toHaveAttribute("href", SIGNUP);
		await expect.element(link).toHaveAttribute("target", "_blank");
		await expect.element(link).toHaveAttribute("rel", "noopener noreferrer");
		const source = screen.getByRole("link", { name: new RegExp(META.notes.noi_meaning.title) });
		await expect.element(source).toHaveAttribute("href", SOURCE);
	});

	it("leaves out the link and explainer when the meta has none", async () => {
		vi.mocked(getPesticidesMeta).mockResolvedValue({
			...META,
			notes: {},
			links: { spraydays_signup: "" }
		} as never);
		const screen = await setup({ notices: [notice()] });
		await expect.element(screen.getByText("Telone II")).toBeVisible();
		await new Promise((r) => setTimeout(r, 50));
		expect(screen.getByRole("link").elements()).toHaveLength(0);
	});

	it("leaves out the explainer when the meta has no notes at all", async () => {
		vi.mocked(getPesticidesMeta).mockResolvedValue({ ...META, notes: undefined } as never);
		const screen = await setup({ notices: [notice()] });
		// The SprayDays link shows once the meta has loaded; the explainer is left out.
		await expect
			.element(
				screen.getByRole("link", { name: `${m.map_notice_spraydays()} ${m.opens_in_new_tab()}` })
			)
			.toBeVisible();
		expect(screen.getByText(META.notes.noi_meaning.title).elements()).toHaveLength(0);
	});

	it("has no axe violations, in one and list forms", async () => {
		const one = await setup({ notices: [notice()] });
		await expect.element(one.getByText(META.notes.noi_meaning.summary)).toBeVisible();
		const results = await axe.run(one.container);
		expect(results.violations).toEqual([]);
		one.unmount();
		const list = await setup({ notices: [notice({ id: "a" }), notice({ id: "b" })] });
		const listResults = await axe.run(list.container);
		expect(listResults.violations).toEqual([]);
	});

	describe("the hover form", () => {
		const FOCUSABLE = "button, a, input, select, textarea, [tabindex]";
		const list = () => [
			notice({ id: "a", scheduled: "2026-11-12T06:00:00-08:00" }),
			notice({ id: "b", scheduled: "2026-11-14T09:30:00-08:00" })
		];

		it("one notice: its date and time, place and amount, with nothing focusable", async () => {
			const screen = await setup({ notices: [notice()], interactive: false });
			await expect.element(screen.getByText(at("2026-11-14T09:30:00-08:00"))).toBeVisible();
			await expect
				.element(screen.getByText(m.map_notice_where({ section: "M15S20E01", county: "Fresno" })))
				.toBeVisible();
			await expect
				.element(screen.getByText(m.map_notice_amount({ amount: formatNumber(12.5), units: "A" })))
				.toBeVisible();
			// Give the meta time to arrive: the hover form still shows no links.
			await new Promise((r) => setTimeout(r, 50));
			expect(screen.container.querySelectorAll(FOCUSABLE)).toHaveLength(0);
			expect(screen.container.textContent).not.toContain("Telone II");
		});

		it("several notices: the heading and a summary, without row buttons", async () => {
			const screen = await setup({ notices: list(), interactive: false });
			await expect
				.element(screen.getByText(m.map_notice_list_heading({ count: "2", countValue: 2 })))
				.toBeVisible();
			await expect
				.element(
					screen.getByText(
						m.map_notice_list_span({
							first: formatDate(new Date("2026-11-12T06:00:00-08:00")),
							last: formatDate(new Date("2026-11-14T09:30:00-08:00"))
						})
					)
				)
				.toBeVisible();
			await new Promise((r) => setTimeout(r, 50));
			expect(screen.container.querySelectorAll(FOCUSABLE)).toHaveLength(0);
		});

		it("the pinned form still has its buttons and links", async () => {
			const screen = await setup({ notices: list() });
			await expect.poll(() => screen.container.querySelectorAll("a").length).toBe(2);
			expect(screen.container.querySelectorAll("button")).toHaveLength(2);
		});
	});
});
