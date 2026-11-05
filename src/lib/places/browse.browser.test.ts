import "../../app.css";
import axe from "axe-core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import type { PlaceDirectory } from "./directory";
import PlacePicker from "./PlacePicker.svelte";
import type { PickerMode } from "./selection";
import type { MonitorOption, RegionOption, RegionTypeInfo } from "./types";

const types: RegionTypeInfo[] = [
	{ type: "county", label: "County", plural: "Counties", count: 8, parents: [] },
	{ type: "zipcode", label: "ZIP Code", plural: "ZIP Code", count: 1161, parents: ["county"] },
	{ type: "city", label: "City", plural: "City", count: 62, parents: ["county"] }
];

function region(type: string, code: string, name: string, typeLabel: string): RegionOption {
	return { kind: "region", type, code, name, typeLabel, county: null };
}
const counties = [
	region("county", "06019", "Fresno County", "County"),
	region("county", "06029", "Kern County", "County"),
	region("county", "06107", "Tulare County", "County")
];
const zips = Array.from({ length: 130 }, (_, i) =>
	region("zipcode", `93${String(100 + i)}`, `ZIP 93${100 + i}`, "ZIP Code")
);
const tulareZips = [
	region("zipcode", "93215", "ZIP 93215", "ZIP Code"),
	region("zipcode", "93221", "ZIP 93221", "ZIP Code")
];
const monitors: MonitorOption[] = ["Fresno - Garland", "Visalia - Main", "Delano - Cecil"].map(
	(name) => ({
		kind: "monitor",
		id: `m-${name}`,
		name,
		network: "PurpleAir",
		county: "Fresno",
		active: true
	})
);

function directory(): PlaceDirectory {
	return {
		regionTypes: vi.fn(async () => types),
		regionTypeLabels: vi.fn(async () => new Map(types.map((t) => [t.type, t.label]))),
		locationTypes: vi.fn(async () => []),
		monitors: vi.fn(async () => monitors),
		regionsIn: vi.fn(async (type, parent) => {
			if (type === "county") return counties;
			if (type === "zipcode") return parent ? tulareZips : zips;
			return [];
		})
	};
}

async function show(mode: PickerMode = { kind: "single" }) {
	const dir = directory();
	const ondone = vi.fn();
	const screen = await render(PlacePicker, {
		directory: dir,
		purpose: { dataset: "air-quality", entryType: "pm25" },
		mode,
		initial: [],
		recent: [],
		locate: async () => ({ ok: false as const, reason: "denied" as const }),
		pointKeys: async () => [],
		ondone,
		oncancel: vi.fn()
	});
	return { screen, dir, ondone };
}

beforeEach(async () => {
	await page.viewport(1280, 800);
});

describe("Browse", () => {
	test("lists each type with its count, plus Monitors", async () => {
		const { screen } = await show();
		await expect.element(screen.getByRole("button", { name: /Counties.*8/ })).toBeVisible();
		await expect.element(screen.getByRole("button", { name: /ZIP Code.*1,161/ })).toBeVisible();
		await expect.element(screen.getByRole("button", { name: /City.*62/ })).toBeVisible();
		await expect.element(screen.getByRole("button", { name: /^Monitors/ })).toBeVisible();
	});

	test("a type opens with In: (all counties) and a filter; choosing a county narrows", async () => {
		const { screen, dir } = await show();
		await screen.getByRole("button", { name: /ZIP Code/ }).click();
		await expect.element(screen.getByRole("heading", { name: "ZIP Code" })).toBeVisible();
		const select = screen.getByRole("combobox", { name: "In:" });
		await expect.element(select).toHaveDisplayValue("All Counties");
		await expect.element(screen.getByRole("textbox", { name: "Filter ZIP Code" })).toBeVisible();
		expect(dir.regionsIn).toHaveBeenCalledWith("zipcode", null, expect.anything());
		await select.selectOptions("Tulare County");
		await expect.element(screen.getByRole("row", { name: /ZIP 93215/ })).toBeVisible();
		expect(dir.regionsIn).toHaveBeenCalledWith(
			"zipcode",
			{ type: "county", code: "06107" },
			expect.anything()
		);
	});

	test("long lists render in pages with Show more", async () => {
		const { screen } = await show();
		await screen.getByRole("button", { name: /ZIP Code/ }).click();
		await expect.element(screen.getByRole("row", { name: /ZIP 93100/ })).toBeVisible();
		expect(document.querySelectorAll("[role=row]").length).toBe(50);
		await screen.getByRole("button", { name: "Show more" }).click();
		expect(document.querySelectorAll("[role=row]").length).toBe(100);
	});

	test("the filter narrows by name; nothing left says Nothing here", async () => {
		const { screen } = await show();
		await screen.getByRole("button", { name: /Counties/ }).click();
		const filter = screen.getByRole("textbox", { name: "Filter Counties" });
		await userEvent.fill(filter, "kern");
		await expect.element(screen.getByRole("row", { name: /Kern County/ })).toBeVisible();
		expect(document.querySelectorAll("[role=row]").length).toBe(1);
		await userEvent.fill(filter, "zzz");
		await expect.element(screen.getByText("Nothing here").nth(1)).toBeVisible();
		expect(document.querySelector("[data-picker-error]")).toBeNull();
	});

	test("Inside > lists child types and opens one narrowed; Back restores focus", async () => {
		const { screen, dir } = await show();
		await screen.getByRole("button", { name: /Counties/ }).click();
		const inside = screen.getByRole("button", { name: "Inside Tulare County" });
		await inside.click();
		await expect
			.element(screen.getByRole("heading", { name: "Inside Tulare County" }))
			.toBeVisible();
		expect(document.body.textContent).not.toMatch(/Counties\s*8/);
		await screen.getByRole("button", { name: /ZIP Code/ }).click();
		await expect.element(screen.getByRole("row", { name: /ZIP 93215/ })).toBeVisible();
		expect(dir.regionsIn).toHaveBeenCalledWith(
			"zipcode",
			{ type: "county", code: "06107" },
			expect.anything()
		);
		await expect
			.element(screen.getByRole("combobox", { name: "In:" }))
			.toHaveDisplayValue("Tulare County");
		await screen.getByRole("button", { name: "Back" }).click();
		await expect
			.element(screen.getByRole("heading", { name: "Inside Tulare County" }))
			.toBeVisible();
		await screen.getByRole("button", { name: "Back" }).click();
		await expect
			.element(screen.getByRole("button", { name: "Inside Tulare County" }))
			.toHaveFocus();
		await screen.getByRole("button", { name: "Back" }).click();
		await expect.element(screen.getByRole("button", { name: /Counties/ })).toHaveFocus();
	});

	test("single mode: a row click picks", async () => {
		const { screen, ondone } = await show();
		await screen.getByRole("button", { name: /Counties/ }).click();
		await screen.getByRole("row", { name: /Kern County/ }).click();
		expect(ondone).toHaveBeenCalledWith([{ kind: "region", type: "county", code: "06029" }]);
	});

	test("multiple mode: checkbox rows in a multiselectable listbox, blocked rows say why", async () => {
		const { screen, ondone } = await show({ kind: "multiple", max: 5 });
		await screen.getByRole("button", { name: /^Monitors/ }).click();
		const list = screen.getByRole("grid", { name: "Places in this list" });
		await expect.element(list).toHaveAttribute("aria-multiselectable", "true");
		await screen.getByRole("row", { name: /Fresno - Garland/ }).click();
		await expect
			.element(screen.getByRole("row", { name: /Fresno - Garland/ }))
			.toHaveAttribute("aria-selected", "true");
		expect(ondone).not.toHaveBeenCalled();
		await screen.getByRole("button", { name: "Back" }).click();
		await screen.getByRole("button", { name: /Counties/ }).click();
		const kern = screen.getByRole("row", { name: /Kern County/ });
		await expect.element(kern).toHaveAttribute("aria-disabled", "true");
		const reason = document.getElementById(kern.element().getAttribute("aria-describedby")!)!;
		expect(reason.textContent).toBe(
			"This widget compares monitors. Remove the monitors to compare regions."
		);
	});

	test("Monitors is a flat filterable list", async () => {
		const { screen, dir } = await show();
		await screen.getByRole("button", { name: /^Monitors/ }).click();
		expect(dir.monitors).toHaveBeenCalledWith("pm25", { activeOnly: false }, expect.anything());
		await expect.element(screen.getByRole("row", { name: /Delano - Cecil/ })).toBeVisible();
		await userEvent.fill(screen.getByRole("textbox", { name: "Filter Monitors" }), "visalia");
		expect(document.querySelectorAll("[role=row]").length).toBe(1);
	});

	test("arrow keys move between rows and into the Inside cell; Enter opens it", async () => {
		const { screen } = await show();
		await screen.getByRole("button", { name: /Counties/ }).click();
		await expect.element(screen.getByRole("row", { name: /Fresno County/ })).toBeVisible();
		const cell = (r: number, c: number) =>
			document.querySelector(`[data-cell="${r}-${c}"]`) as HTMLElement;
		cell(0, 0).focus();
		await userEvent.keyboard("{ArrowDown}");
		expect(document.activeElement).toBe(cell(1, 0));
		await userEvent.keyboard("{ArrowRight}");
		expect(document.activeElement).toBe(cell(1, 1));
		await userEvent.keyboard("{ArrowUp}");
		expect(document.activeElement).toBe(cell(0, 1));
		await userEvent.keyboard("{ArrowLeft}{End}");
		expect(document.activeElement).toBe(cell(2, 0));
		await userEvent.keyboard("{Home}{ArrowRight}{Enter}");
		await expect
			.element(screen.getByRole("heading", { name: "Inside Fresno County" }))
			.toBeVisible();
	});

	test("Space and Enter on a row pick it", async () => {
		const { screen, ondone } = await show();
		await screen.getByRole("button", { name: /Counties/ }).click();
		await expect.element(screen.getByRole("row", { name: /Kern County/ })).toBeVisible();
		(document.querySelector('[data-cell="1-0"]') as HTMLElement).focus();
		await userEvent.keyboard(" ");
		expect(ondone).toHaveBeenCalledWith([{ kind: "region", type: "county", code: "06029" }]);
	});

	test("the live region announces the count, an empty narrowing, and a load error", async () => {
		const { screen, dir } = await show();
		const live = () =>
			[...document.querySelectorAll("[data-browse-live] p")].map((p) => p.textContent).join("|");
		await screen.getByRole("button", { name: /Counties/ }).click();
		await expect.poll(live).toBe("3 results");
		await userEvent.fill(screen.getByRole("textbox", { name: "Filter Counties" }), "kern");
		await expect.poll(live).toBe("1 result");
		await userEvent.fill(screen.getByRole("textbox", { name: "Filter Counties" }), "zzz");
		await expect.poll(live).toBe("Nothing here");
		await screen.getByRole("button", { name: "Back" }).click();
		vi.mocked(dir.regionsIn).mockRejectedValueOnce(new Error("down"));
		await screen.getByRole("button", { name: /City/ }).click();
		await expect.poll(live).toBe("Couldn't load this list.");
	});

	test("axe clean in the type list and in a list", async () => {
		const { screen } = await show({ kind: "multiple", max: 5 });
		await expect.element(screen.getByRole("button", { name: /Counties/ })).toBeVisible();
		document.body.style.background = "#ffffff";
		let results = await axe.run(screen.container);
		expect(results.violations).toEqual([]);
		await screen.getByRole("button", { name: /Counties/ }).click();
		await expect.element(screen.getByRole("row", { name: /Kern County/ })).toBeVisible();
		results = await axe.run(screen.container);
		expect(results.violations).toEqual([]);
		document.body.style.background = "";
	});
});
