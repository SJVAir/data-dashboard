import "../../app.css";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { CatalogEntry, MetadataSource, MonitorTypeInfo } from "$lib/data/metadata";
import type { WidgetDataConfig } from "$lib/data/schema";
import { FIXTURE_CATALOG, fixtureMetadata } from "$lib/data/testing/fixtures";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { animationsSettled } from "../../test/animations";
import AirQualityHarness from "./test-harness/AirQualityHarness.svelte";

vi.mock("@sjvair/sdk");

const fake = vi.hoisted(() => ({ metadata: undefined as unknown as MetadataSource }));
vi.mock("$lib/data", () => ({
	getMetadata: () => fake.metadata,
	getResolvers: () => ({
		regions: { resolve: async () => null },
		locations: { resolve: async () => null },
		points: { keys: async () => [] }
	})
}));

/** The fixtures' air quality, with the monitor types its monitors are (the bulk `type` ids). */
const CATALOG: CatalogEntry[] = [
	{ ...FIXTURE_CATALOG[0], monitorTypes: ["bam1022", "purpleair", "airnow"] }
];

const AIRNOW: MonitorTypeInfo = {
	type: "airnow",
	label: "AirNow",
	entryTypes: ["pm25", "o3"],
	group: "reference",
	published: ["pm25", "o3"]
};

const FRESNO = { kind: "region" as const, type: "county", code: "06019" };

function pm25(layer: Partial<WidgetDataConfig["layers"][number]> = {}): WidgetDataConfig {
	return { place: FRESNO, layers: [{ dataset: "air-quality", entryType: "pm25", ...layer }] };
}

beforeEach(() => {
	const base = fixtureMetadata();
	fake.metadata = fixtureMetadata({
		monitorTypes: async () => [...(await base.monitorTypes()), AIRNOW]
	});
});

async function show(initial: WidgetDataConfig, limit = Infinity) {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const changes: WidgetDataConfig[] = [];
	const screen = await render(AirQualityHarness, {
		props: { initial, catalog: CATALOG, limit, onchange: (d) => changes.push(d) },
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
	return { screen, changes, last: () => changes.at(-1) };
}

const dialog = (name: string) => page.getByRole("dialog", { name });
const addButton = () => page.getByRole("button", { name: m.get_data_monitors_add() });

/** Searches the open dialog for `query` and picks the option named by `name`. */
async function pick(query: string, name: RegExp) {
	const box = page.getByRole("combobox");
	await expect.element(box).toBeVisible();
	await userEvent.fill(box, query);
	await page.getByRole("option", { name }).click();
}

describe("air quality section", () => {
	test("air quality section: Add monitors opens the monitor search; a pick is listed and removable", async () => {
		const { last } = await show(pm25());
		// The types in their meta groups, labelled from the meta.
		await expect
			.element(
				page
					.getByRole("group", { name: "Reference-grade" })
					.getByRole("checkbox", { name: "BAM 1022" })
			)
			.not.toBeChecked();
		await expect
			.element(
				page
					.getByRole("group", { name: "Low-cost sensors" })
					.getByRole("checkbox", { name: "PurpleAir" })
			)
			.toBeVisible();
		await page.getByRole("checkbox", { name: "PurpleAir" }).click();
		expect(last()?.layers[0].monitorTypes).toEqual(["purpleair"]);

		await addButton().click();
		await expect.element(dialog(m.get_data_monitors_dialog_title())).toBeVisible();
		await animationsSettled(dialog(m.get_data_monitors_dialog_title()).element());
		await pick("ba", /BAM/);
		await page.getByRole("button", { name: m.place_picker_done() }).click();
		await expect.element(dialog(m.get_data_monitors_dialog_title())).not.toBeInTheDocument();
		expect(last()?.layers[0].monitors).toEqual(["m-bam"]);
		// Monitors aren't a Where: the county stays.
		expect(last()?.place).toEqual(FRESNO);

		const list = page.getByRole("list", { name: m.get_data_monitors_picked() });
		await expect.element(list.getByText("BAM (BAM 1022)")).toBeVisible();
		await page
			.getByRole("button", { name: m.get_data_monitors_remove_label({ name: "BAM" }) })
			.click();
		expect(last()?.layers[0]).not.toHaveProperty("monitors");
		await expect.element(list).not.toBeInTheDocument();
		// Nothing left in the list: focus goes to Add monitors, never <body>.
		await expect.element(addButton()).toHaveFocus();
	});

	test("removing a monitor moves focus to the next row", async () => {
		await show(pm25({ monitors: ["m-pa", "m-bam"] }));
		const removeBam = page.getByRole("button", {
			name: m.get_data_monitors_remove_label({ name: "BAM" })
		});
		await expect.element(removeBam).toBeVisible();
		await page
			.getByRole("button", { name: m.get_data_monitors_remove_label({ name: "Purple Air" }) })
			.click();
		await expect.element(removeBam).toHaveFocus();
	});

	test("air quality section: single-place types show only the search, single mode", async () => {
		const { last } = await show(pm25(), 1);
		await expect
			.element(page.getByRole("button", { name: m.get_data_monitors_choose() }))
			.toBeVisible();
		expect(document.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
		await page.getByRole("button", { name: m.get_data_monitors_choose() }).click();
		const single = dialog(m.get_data_monitors_dialog_title_single());
		await expect.element(single).toBeVisible();
		await animationsSettled(single.element());
		await pick("ba", /BAM/);
		// Single mode: the pick is the choice (no Done).
		await expect.element(single).not.toBeInTheDocument();
		expect(last()?.layers[0].monitors).toEqual(["m-bam"]);
		// One place or one monitor (decision 11): the Where goes.
		expect(last()).not.toHaveProperty("place");
		await page.getByRole("button", { name: m.get_data_monitors_choose() }).click();
		await animationsSettled(single.element());
		await pick("pu", /Purple Air/);
		expect(last()?.layers[0].monitors).toEqual(["m-pa"]);
	});

	test("with None, the ticks and monitors stay, greyed with their reason; the search is disabled", async () => {
		const { last } = await show(pm25({ monitorTypes: ["purpleair"], monitors: ["m-bam"] }));
		await page.getByRole("radio", { name: m.get_data_none() }).click();
		expect(last()?.layers).toEqual([
			{ dataset: "air-quality", monitorTypes: ["purpleair"], monitors: ["m-bam"] }
		]);
		const purple = page.getByRole("checkbox", { name: "PurpleAir" });
		await expect.element(purple).toBeChecked();
		// Greyed with its reason, but a choice can always be removed.
		await expect.element(purple).toBeEnabled();
		await expect
			.element(purple)
			.toHaveAccessibleDescription(m.get_data_monitor_type_no_pollutant());
		// Not ticked: it can't be ticked until a pollutant is chosen.
		await expect.element(page.getByRole("checkbox", { name: "AirNow" })).toBeDisabled();
		await expect.element(addButton()).toBeDisabled();
		await expect
			.element(addButton())
			.toHaveAccessibleDescription(m.get_data_monitors_choose_pollutant());
		await expect
			.element(page.getByRole("list", { name: m.get_data_monitors_picked() }).getByRole("listitem"))
			.toHaveAccessibleDescription(m.get_data_monitor_type_no_pollutant());

		// A pollutant again: the same ticks and monitors, enabled.
		await page.getByRole("radio", { name: "PM2.5" }).click();
		expect(last()?.layers).toEqual([
			{
				dataset: "air-quality",
				entryType: "pm25",
				monitorTypes: ["purpleair"],
				monitors: ["m-bam"]
			}
		]);
		await expect.element(purple).toBeEnabled();
		await expect.element(addButton()).toBeEnabled();
	});

	test("under None a ticked type can be unticked: it's removed", async () => {
		const { last } = await show(pm25({ monitorTypes: ["purpleair", "bam1022"] }));
		await page.getByRole("radio", { name: m.get_data_none() }).click();
		const purple = page.getByRole("checkbox", { name: "PurpleAir" });
		await purple.click();
		expect(last()?.layers).toEqual([{ dataset: "air-quality", monitorTypes: ["bam1022"] }]);
		await expect.element(purple).not.toBeChecked();
		// Now unticked and greyed: it can't be ticked again until a pollutant is chosen.
		await expect.element(purple).toBeDisabled();
		await expect
			.element(purple)
			.toHaveAccessibleDescription(m.get_data_monitor_type_no_pollutant());
	});

	test("a type that doesn't measure ozone is greyed with its reason and stays ticked", async () => {
		await show(pm25({ entryType: "o3", monitorTypes: ["purpleair", "airnow"] }));
		const purple = page.getByRole("checkbox", { name: "PurpleAir" });
		await expect.element(purple).toBeChecked();
		await expect.element(purple).toBeEnabled();
		// Unticked and not measuring ozone: it can't be ticked.
		await expect.element(page.getByRole("checkbox", { name: "BAM 1022" })).toBeDisabled();
		const reason = m.get_data_monitor_type_not_supplied({ pollutant: "Ozone" });
		await expect.element(purple).toHaveAccessibleDescription(reason);
		const airnow = page.getByRole("checkbox", { name: "AirNow" });
		await expect.element(airnow).toBeEnabled();
		await expect.element(airnow).toBeChecked();
	});
});
