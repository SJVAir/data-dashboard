import "../../app.css";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { searchLocations, searchRegionPlaces } from "@sjvair/sdk";
import { m } from "$lib/paraglide/messages.js";
import type { GeoResult } from "$lib/platform/types";
import { animationsSettled } from "../../test/animations";
import type { PlaceDirectory } from "./directory";
import PlacePicker from "./PlacePicker.svelte";
import type { PickerMode, Picks } from "./selection";
import type { LocationOption, MonitorOption, PlaceOption, RegionOption } from "./types";

vi.mock("@sjvair/sdk");

type LocationRow = Awaited<ReturnType<typeof searchLocations>>["results"][number];
type RegionRow = Awaited<ReturnType<typeof searchRegionPlaces>>[number];

function locationRow(name: string, code: string): LocationRow {
	return {
		source: "cde-public",
		external_id: code,
		name,
		type: "public_school",
		city_name: "Fresno",
		zip: "93702",
		address: "4250 E Tulare Ave",
		retired: null
	} as unknown as LocationRow;
}

function regionRow(name: string, code: string, type = "city"): RegionRow {
	return { type, external_id: code, name, retired: null } as unknown as RegionRow;
}

function monitor(name: string, active = true): MonitorOption {
	return { kind: "monitor", id: `m-${name}`, name, network: "PurpleAir", county: "Fresno", active };
}

const fresnoCounty: RegionOption = {
	kind: "region",
	type: "county",
	code: "06019",
	name: "Fresno County",
	typeLabel: "County",
	county: null
};
const roosevelt: LocationOption = {
	kind: "location",
	source: "cde-public",
	code: "100",
	name: "Roosevelt High School",
	typeLabel: "Public school",
	city: "Fresno",
	zip: "93702",
	address: "4250 E Tulare Ave"
};
const garland = monitor("Fresno - Garland");

let monitors: MonitorOption[];

function directory(): PlaceDirectory {
	return {
		regionTypes: vi.fn(async () => []),
		regionTypeLabels: vi.fn(
			async () =>
				new Map([
					["city", "City"],
					["county", "County"]
				])
		),
		locationTypes: vi.fn(async () => [
			{ type: "public_school", label: "Public school", source: "cde-public" }
		]),
		monitors: vi.fn(async () => monitors),
		monitorsIn: vi.fn(async () => []),
		regionsIn: vi.fn(async () => [])
	};
}

/** Four of each kind: 12 results for "fr". */
function twelve() {
	vi.mocked(searchLocations).mockResolvedValue({
		results: ["Fremont Elementary", "Fresno High", "Frank Elementary", "Fruit Ridge"].map((n, i) =>
			locationRow(n, `l${i}`)
		),
		more: false
	});
	vi.mocked(searchRegionPlaces).mockResolvedValue(
		["Fresno", "Friant", "Frazier Park", "French Camp"].map((n, i) => regionRow(n, `r${i}`))
	);
	monitors = ["Fresno - Garland", "Fresno - Drummond", "Friant Rd", "Frontier School"].map((n) =>
		monitor(n)
	);
}

type Options = {
	mode?: PickerMode;
	initial?: Picks;
	recent?: PlaceOption[];
	known?: PlaceOption[];
	locate?: (signal: AbortSignal) => Promise<GeoResult>;
	pointKeys?: (lat: number, lon: number, signal: AbortSignal) => Promise<string[]>;
};

async function show(opts: Options = {}) {
	const ondone = vi.fn();
	const oncancel = vi.fn();
	const locate = vi.fn(
		opts.locate ?? (async (): Promise<GeoResult> => ({ ok: false, reason: "denied" }))
	);
	const pointKeys = vi.fn(opts.pointKeys ?? (async () => ["zipcode:93721"]));
	const screen = await render(PlacePicker, {
		directory: directory(),
		purpose: { dataset: "air-quality", entryType: "pm25" },
		mode: opts.mode ?? { kind: "single" },
		initial: opts.initial ?? [],
		recent: opts.recent ?? [],
		known: opts.known,
		locate,
		pointKeys,
		ondone,
		oncancel
	});
	const input = screen.getByRole("combobox");
	return { screen, input, ondone, oncancel, locate, pointKeys };
}

function inputEl(): HTMLInputElement {
	return document.querySelector("[role=combobox]") as HTMLInputElement;
}

function activeOption(): HTMLElement | null {
	const id = inputEl().getAttribute("aria-activedescendant");
	return id ? document.getElementById(id) : null;
}

/** The live region's messages, each a separate node, joined with " | " for comparing. */
function liveText(): string {
	const live = document.querySelector("[data-picker-live]") as HTMLElement;
	return [...live.children].map((c) => c.textContent?.trim()).join(" | ");
}

beforeEach(async () => {
	vi.resetAllMocks();
	monitors = [];
	vi.mocked(searchLocations).mockResolvedValue({ results: [], more: false });
	vi.mocked(searchRegionPlaces).mockResolvedValue([]);
	await page.viewport(1280, 800);
});

afterEach(() => {
	document.body.style.background = "";
});

for (const [label, width, height] of [
	["desktop", 1280, 800],
	["phone", 390, 844]
] as const) {
	describe(`at ${label} width`, () => {
		beforeEach(async () => {
			await page.viewport(width, height);
		});

		test("the search box is focused, with the placeholder", async () => {
			const { input } = await show();
			await expect.element(input).toHaveFocus();
			expect(inputEl().placeholder).toBe("Search for a city, ZIP, school, or monitor");
			expect(m.place_picker_placeholder()).toBe("Search for a city, ZIP, school, or monitor");
		});

		test("before typing: Recent rows, Use my location and Browse", async () => {
			const { screen } = await show({ recent: [fresnoCounty, roosevelt, garland] });
			await expect.element(screen.getByRole("button", { name: "Use my location" })).toBeVisible();
			await expect.element(screen.getByRole("group", { name: "Recent" })).toBeVisible();
			await expect.element(screen.getByRole("option", { name: /Fresno County/ })).toBeVisible();
			await expect
				.element(screen.getByRole("option", { name: /Roosevelt High School/ }))
				.toBeVisible();
			await expect.element(screen.getByRole("option", { name: /Fresno - Garland/ })).toBeVisible();
			await expect.element(screen.getByRole("heading", { name: "Browse" })).toBeVisible();
			const root = screen.container.firstElementChild as HTMLElement;
			await animationsSettled(root);
			expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
		});

		test("typing shows three labeled groups, then the count", async () => {
			twelve();
			const { screen, input } = await show({ recent: [fresnoCounty] });
			await userEvent.fill(input, "fr");
			await expect
				.element(screen.getByRole("group", { name: "Schools & child care" }))
				.toBeVisible();
			await expect.element(screen.getByRole("group", { name: "Places" })).toBeVisible();
			await expect.element(screen.getByRole("group", { name: "Monitors" })).toBeVisible();
			await expect.poll(liveText).toBe("12 results");
			expect(screen.container.querySelector("[aria-label='Recent']")).toBeNull();
			expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
			document.body.style.background = "#ffffff";
			const results = await axe.run(screen.container);
			expect(results.violations).toEqual([]);
		});
	});
}

test("rows show their details, and Not reporting as text", async () => {
	vi.mocked(searchLocations).mockResolvedValue({
		results: [locationRow("Roosevelt High School", "100")],
		more: false
	});
	vi.mocked(searchRegionPlaces).mockResolvedValue([regionRow("Roosevelt", "r1")]);
	monitors = [monitor("Roosevelt Rooftop", false)];
	const { screen, input } = await show();
	await userEvent.fill(input, "roo");
	const school = screen.getByRole("option", { name: /Roosevelt High School/ });
	await expect.element(school).toBeVisible();
	const schoolText = school.element().textContent;
	expect(schoolText).toContain("Public school");
	expect(schoolText).toContain("Fresno · 93702");
	expect(schoolText).toContain("4250 E Tulare Ave");
	await expect.element(screen.getByRole("option", { name: /^Roosevelt\s*City/ })).toBeVisible();
	const mon = screen.getByRole("option", { name: /Roosevelt Rooftop/ });
	await expect.element(mon).toBeVisible();
	const monText = mon.element().textContent;
	expect(monText).toContain("PurpleAir");
	expect(monText).toContain("Fresno");
	expect(monText).toContain("Not reporting");
});

test("arrow keys move across groups; Enter picks in single mode", async () => {
	twelve();
	const { screen, input, ondone } = await show();
	await userEvent.fill(input, "fr");
	await expect.poll(liveText).toBe("12 results");
	expect(inputEl().getAttribute("aria-expanded")).toBe("true");
	expect(inputEl().getAttribute("aria-controls")).toBe(
		screen.container.querySelector("[role=listbox]")!.id
	);
	expect(inputEl().hasAttribute("aria-activedescendant")).toBe(false);
	await userEvent.keyboard("{ArrowDown}");
	expect(activeOption()?.textContent).toContain("Fremont Elementary");
	for (let i = 0; i < 4; i++) await userEvent.keyboard("{ArrowDown}");
	// Past the four schools: the first place.
	expect(activeOption()?.textContent).toContain("Fresno");
	expect(activeOption()?.closest("[role=group]")?.getAttribute("aria-labelledby")).toBeTruthy();
	expect(activeOption()?.closest("[role=group]")?.textContent).toContain("Places");
	await userEvent.keyboard("{ArrowUp}");
	expect(activeOption()?.textContent).toContain("Fruit Ridge");
	expect(activeOption()?.getAttribute("aria-selected")).toBe("true");
	await userEvent.keyboard("{Enter}");
	expect(ondone).toHaveBeenCalledWith([{ kind: "location", source: "cde-public", code: "l3" }]);
});

test("Escape clears the box, then cancels", async () => {
	twelve();
	const { input, oncancel } = await show();
	await userEvent.fill(input, "fr");
	await expect.poll(liveText).toBe("12 results");
	await userEvent.keyboard("{Escape}");
	expect(inputEl().value).toBe("");
	expect(oncancel).not.toHaveBeenCalled();
	await userEvent.keyboard("{Escape}");
	expect(oncancel).toHaveBeenCalledOnce();
});

test("No matches is announced", async () => {
	const { input } = await show();
	await userEvent.fill(input, "zz");
	await expect.poll(liveText).toBe("No matches");
	expect(inputEl().getAttribute("aria-expanded")).toBe("false");
});

test("a stale response is ignored", async () => {
	let resolveOld!: (v: { results: LocationRow[]; more: boolean }) => void;
	vi.mocked(searchLocations).mockImplementation(async ({ q }) => {
		if (q === "fr") return new Promise((r) => (resolveOld = r));
		return { results: [locationRow("Fresno High", "new")], more: false };
	});
	const { screen, input } = await show();
	await userEvent.fill(input, "fr");
	await expect.poll(() => vi.mocked(searchLocations).mock.calls.length).toBe(1);
	const firstSignal = vi.mocked(searchLocations).mock.calls[0][0].signal!;
	await userEvent.fill(input, "fresno h");
	await expect.element(screen.getByRole("option", { name: /Fresno High/ })).toBeVisible();
	expect(firstSignal.aborted).toBe(true);
	resolveOld({ results: [locationRow("Old Result", "old")], more: false });
	await new Promise((r) => setTimeout(r, 0));
	expect(screen.container.textContent).not.toContain("Old Result");
	expect(liveText()).toBe("1 result");
});

function renderWith(dir: PlaceDirectory) {
	return render(PlacePicker, {
		directory: dir,
		purpose: { dataset: "air-quality", entryType: "pm25" },
		mode: { kind: "single" },
		initial: [],
		recent: [],
		locate: vi.fn(),
		pointKeys: vi.fn(),
		ondone: vi.fn(),
		oncancel: vi.fn()
	});
}

test("a failed group shows Retry while the others show, and is announced", async () => {
	twelve();
	const dir = directory();
	vi.mocked(dir.monitors).mockRejectedValueOnce(new Error("offline"));
	const screen = await renderWith(dir);
	await userEvent.fill(screen.getByRole("combobox"), "fr");
	const notice = () => screen.container.querySelector("[data-picker-error]");
	await expect.poll(() => notice()?.textContent).toContain("Couldn't search monitors.");
	await expect.element(screen.getByRole("group", { name: "Places" })).toBeVisible();
	expect(screen.container.querySelector("[aria-label='Monitors']")).toBeNull();
	await expect.poll(liveText).toBe("8 results | Couldn't search monitors.");
	await screen.getByRole("button", { name: "Retry" }).click();
	await expect.element(screen.getByRole("group", { name: "Monitors" })).toBeVisible();
	await expect.poll(liveText).toBe("12 results");
	expect(notice()).toBeNull();
});

test("when every returned group is empty, only the failure is announced", async () => {
	const dir = directory();
	vi.mocked(dir.monitors).mockRejectedValueOnce(new Error("offline"));
	const screen = await renderWith(dir);
	await userEvent.fill(screen.getByRole("combobox"), "zz");
	await expect.poll(liveText).toBe("Couldn't search monitors.");
});

test("More matches when a group has more", async () => {
	vi.mocked(searchLocations).mockResolvedValue({
		results: [locationRow("Fresno High", "1")],
		more: true
	});
	const { screen, input } = await show();
	await userEvent.fill(input, "fr");
	await expect
		.element(screen.getByText("More matches. Keep typing to narrow them down."))
		.toBeVisible();
});

describe("multiple mode", () => {
	const mode: PickerMode = { kind: "multiple", max: 5 };
	const tulare: RegionOption = { ...fresnoCounty, code: "06107", name: "Tulare County" };

	test("chips with labeled remove buttons, Done and Cancel", async () => {
		const { screen, ondone, oncancel } = await show({
			mode,
			initial: [
				{ kind: "region", type: "county", code: "06019" },
				{ kind: "region", type: "county", code: "06107" }
			],
			known: [fresnoCounty, tulare]
		});
		await expect.element(screen.getByRole("button", { name: "Done" })).toBeEnabled();
		const removeFresno = screen.getByRole("button", { name: "Remove Fresno County" });
		await expect.element(removeFresno).toBeVisible();
		await removeFresno.click();
		await expect
			.element(screen.getByRole("button", { name: "Remove Tulare County" }))
			.toHaveFocus();
		await screen.getByRole("button", { name: "Done" }).click();
		expect(ondone).toHaveBeenCalledWith([{ kind: "region", type: "county", code: "06107" }]);
		await screen.getByRole("button", { name: "Cancel" }).click();
		expect(oncancel).toHaveBeenCalledOnce();
	});

	test("Done needs a pick", async () => {
		const { screen, ondone } = await show({ mode });
		const done = screen.getByRole("button", { name: "Done" });
		await expect.element(done).toBeDisabled();
		(done.element() as HTMLButtonElement).click();
		expect(ondone).not.toHaveBeenCalled();
	});

	test("Enter adds a pick as a chip and keeps the picker open", async () => {
		const { screen, input, ondone } = await show({ mode, recent: [fresnoCounty, tulare] });
		await input.click();
		expect(
			screen.container.querySelector("[role=listbox]")!.getAttribute("aria-multiselectable")
		).toBe("true");
		await userEvent.keyboard("{ArrowDown}{Enter}");
		await expect
			.element(screen.getByRole("button", { name: "Remove Fresno County" }))
			.toBeVisible();
		expect(activeOption()?.getAttribute("aria-selected")).toBe("true");
		expect(ondone).not.toHaveBeenCalled();
		// Enter again on the picked row removes it.
		await userEvent.keyboard("{Enter}");
		expect(screen.container.querySelector("[aria-label='Remove Fresno County']")).toBeNull();
	});

	test("a blocked row is aria-disabled and focusable, with its reason as its description", async () => {
		const { screen, input } = await show({
			mode,
			initial: [
				{ kind: "region", type: "county", code: "06019" },
				{ kind: "region", type: "county", code: "06107" }
			],
			known: [fresnoCounty, tulare],
			recent: [garland, roosevelt]
		});
		await input.click();
		await userEvent.keyboard("{ArrowDown}");
		const row = activeOption()!;
		expect(row.textContent).toContain("Fresno - Garland");
		expect(row.getAttribute("aria-disabled")).toBe("true");
		const reason = document.getElementById(row.getAttribute("aria-describedby")!)!;
		expect(reason.textContent).toBe(
			"This widget compares regions. Remove the regions to compare monitors."
		);
		await userEvent.keyboard("{Enter}");
		expect(screen.container.querySelector("[aria-label='Remove Fresno - Garland']")).toBeNull();
		await userEvent.keyboard("{ArrowDown}");
		const school = activeOption()!;
		expect(document.getElementById(school.getAttribute("aria-describedby")!)!.textContent).toBe(
			"A school or your location can only be shown on its own."
		);
		document.body.style.background = "#ffffff";
		const results = await axe.run(screen.container);
		expect(results.violations).toEqual([]);
	});

	test("a school row replaces a single picked place and says so", async () => {
		twelve();
		const { screen, input, ondone } = await show({
			mode,
			initial: [{ kind: "region", type: "county", code: "06019" }],
			known: [fresnoCounty]
		});
		await userEvent.fill(input, "fr");
		const school = screen.getByRole("option", { name: /Fremont Elementary/ });
		await expect.element(school).toBeVisible();
		expect(school.element().getAttribute("aria-disabled")).toBeNull();
		await school.click();
		await expect
			.element(screen.getByRole("button", { name: "Remove Fremont Elementary" }))
			.toBeVisible();
		expect(screen.container.querySelector("[aria-label='Remove Fresno County']")).toBeNull();
		expect(liveText()).toBe("Fremont Elementary replaced Fresno County.");
		expect(ondone).not.toHaveBeenCalled();
		await screen.getByRole("button", { name: "Done" }).click();
		expect(ondone).toHaveBeenCalledWith([{ kind: "location", source: "cde-public", code: "l0" }]);
	});

	test("an alone pick names itself in the reason; at the cap rows say so", async () => {
		const alone = await show({
			mode,
			initial: [{ kind: "location", source: "cde-public", code: "100" }],
			known: [roosevelt],
			recent: [fresnoCounty]
		});
		await alone.input.click();
		await userEvent.keyboard("{ArrowDown}");
		expect(
			document.getElementById(activeOption()!.getAttribute("aria-describedby")!)!.textContent
		).toBe("Remove Roosevelt High School to add other places.");
		alone.screen.unmount();

		const capped = await show({
			mode: { kind: "multiple", max: 2 },
			initial: [
				{ kind: "region", type: "county", code: "06107" },
				{ kind: "region", type: "county", code: "06031" }
			],
			known: [tulare, { ...fresnoCounty, code: "06031", name: "Kings County" }],
			recent: [fresnoCounty]
		});
		await capped.input.click();
		await userEvent.keyboard("{ArrowDown}");
		expect(
			document.getElementById(activeOption()!.getAttribute("aria-describedby")!)!.textContent
		).toBe("This widget shows up to 2 places.");
	});
});

describe("Use my location", () => {
	test("picks the point at once when it's inside the area", async () => {
		const { screen, ondone, pointKeys } = await show({
			locate: async () => ({ ok: true, lat: 36.75, lon: -119.77 })
		});
		await screen.getByRole("button", { name: "Use my location" }).click();
		await expect.poll(() => ondone.mock.calls.length).toBe(1);
		expect(ondone).toHaveBeenCalledWith([{ kind: "point", lat: 36.75, lon: -119.77 }]);
		expect(pointKeys).toHaveBeenCalledWith(36.75, -119.77, expect.any(AbortSignal));
	});

	test("denied says location access is off, in a status region there before the click", async () => {
		const { screen, ondone } = await show({
			locate: async () => ({ ok: false, reason: "denied" })
		});
		const region = screen.container.querySelector("[data-picker-location-status]") as HTMLElement;
		expect(region).not.toBeNull();
		expect(region.getAttribute("role")).toBe("status");
		expect(getComputedStyle(region).display).not.toBe("none");
		expect(region.textContent?.trim()).toBe("");
		await screen.getByRole("button", { name: "Use my location" }).click();
		await expect
			.element(screen.getByText("Location access is off. Search for a place instead."))
			.toBeVisible();
		expect(region.textContent?.trim()).toBe("Location access is off. Search for a place instead.");
		expect(ondone).not.toHaveBeenCalled();
	});

	test("outside the area picks nothing", async () => {
		const { screen, ondone } = await show({
			locate: async () => ({ ok: true, lat: 40, lon: -100 }),
			pointKeys: async () => []
		});
		await screen.getByRole("button", { name: "Use my location" }).click();
		await expect
			.element(screen.getByText("Your location is outside the area SJVAir covers."))
			.toBeVisible();
		expect(ondone).not.toHaveBeenCalled();
	});

	test("with one place picked, replaces it", async () => {
		const { screen, ondone } = await show({
			mode: { kind: "multiple", max: 5 },
			initial: [{ kind: "region", type: "county", code: "06019" }],
			known: [fresnoCounty],
			locate: async () => ({ ok: true, lat: 36.75, lon: -119.77 })
		});
		const button = screen.getByRole("button", { name: "Use my location" });
		expect(button.element().getAttribute("aria-disabled")).toBeNull();
		await button.click();
		await expect.poll(() => ondone.mock.calls.length).toBe(1);
		expect(ondone).toHaveBeenCalledWith([{ kind: "point", lat: 36.75, lon: -119.77 }]);
	});

	test("is blocked with a reason once two other places are picked", async () => {
		const { screen, locate } = await show({
			mode: { kind: "multiple", max: 5 },
			initial: [
				{ kind: "region", type: "county", code: "06019" },
				{ kind: "region", type: "county", code: "06107" }
			],
			known: [fresnoCounty, { ...fresnoCounty, code: "06107", name: "Tulare County" }]
		});
		const button = screen.getByRole("button", { name: "Use my location" });
		await expect.element(button).toHaveAttribute("aria-disabled", "true");
		await expect
			.element(button)
			.toHaveAccessibleDescription("A school or your location can only be shown on its own.");
		// Playwright won't click an aria-disabled button; a person (or a script) still can.
		(button.element() as HTMLElement).click();
		expect(locate).not.toHaveBeenCalled();
	});
});

test("unmounting aborts the search and locate", async () => {
	vi.mocked(searchLocations).mockImplementation(() => new Promise(() => {}));
	let locateSignal: AbortSignal | undefined;
	const { screen, input } = await show({
		locate: (signal) => {
			locateSignal = signal;
			return new Promise(() => {});
		}
	});
	await userEvent.fill(input, "fr");
	await expect.poll(() => vi.mocked(searchLocations).mock.calls.length).toBe(1);
	await screen.getByRole("button", { name: "Use my location" }).click();
	await expect.poll(() => locateSignal).toBeDefined();
	screen.unmount();
	expect(vi.mocked(searchLocations).mock.calls[0][0].signal!.aborted).toBe(true);
	expect(locateSignal!.aborted).toBe(true);
});
