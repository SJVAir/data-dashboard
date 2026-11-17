import { beforeEach, describe, expect, it, vi } from "vitest";

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
import type { FeatureListItem, MapContext } from "@sjvair/map-sdk";
import type { DataSource } from "@sjvair/map-sdk/data";
import { createRawSnippet, flushSync, type Snippet } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import "../../../app.css";
import { formatValue } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import type { UseProps } from "./data/use";
import { buildUseScale } from "./data/use-scale";
import UseLayers from "./layers/UseLayers.svelte";
import RenderSnippet from "./test-harness/RenderSnippet.svelte";
import { FakeMap, fakeLenses, type FakeLens } from "./test-harness/fake-map.svelte";
import TownshipCard from "./TownshipCard.svelte";
import { useTooltips } from "./use-tooltip";

const FIGURES = [
	{ id: "pounds-applied", label: "Pounds Applied", units: "lbs", precision: 0 },
	{ id: "acres-treated", label: "Acres Treated", units: "acres", precision: 1 },
	{ id: "applications", label: "Applications", units: "applications", precision: 0 }
];
const PERIOD = { year: 2023, month: null };
const SCALE = buildUseScale(
	{
		breaks: [100, 1000, 4079, 6714, 9000, 12000, 20000, 50000],
		min: null,
		colors: ["#111", "#222", "#333", "#444", "#555", "#666", "#777", "#888"]
	},
	{ label: "Pounds Applied", units: "lbs", precision: 0 }
);
const REF = "feature:township:MDM-T15S-R20E";

function township(over: Partial<UseProps> = {}): UseProps {
	return {
		refKey: REF,
		name: "MDM-T15S-R20E",
		value: 5000,
		level: "township",
		id: "MDM-T15S-R20E",
		county: null,
		township: "MDM-T15S-R20E",
		sections: 36,
		lbs_chemical: 5000,
		acres_treated: 812.25,
		applications: 41,
		...over
	};
}

const focusables = (root: Element) =>
	root.querySelectorAll("button, a[href], input, select, textarea, [tabindex]");

function card(over: Record<string, unknown> = {}) {
	return render(TownshipCard, {
		// The cards have a `props` prop, so the mount options are spelled out.
		props: {
			props: township(),
			figure: "pounds-applied",
			figures: FIGURES,
			period: PERIOD,
			scale: SCALE,
			filtersLine: null,
			interactive: true,
			onshow: () => {},
			onzoom: () => {},
			...over
		}
	});
}

describe("TownshipCard", () => {
	it("the township card shows its figures, class in words and section count", async () => {
		const screen = await card({ filtersLine: "Sulfur · Grapes" });
		await expect.element(screen.getByRole("heading", { name: "MDM-T15S-R20E" })).toBeVisible();
		await expect
			.element(screen.getByText(m.map_use_legend_filters({ filters: "Sulfur · Grapes" })))
			.toBeVisible();
		await expect
			.element(
				screen.getByText(
					m.map_use_card_class({ tier: "4", count: "8", range: "4,079 to 6,714", units: "lbs" })
				)
			)
			.toBeVisible();
		const text = screen.container.textContent ?? "";
		const lbs = m.map_use_card_value({ value: formatValue(5000, 0), units: "lbs" });
		const acres = m.map_use_card_value({ value: formatValue(812.25, 1), units: "acres" });
		const apps = m.map_use_card_value({ value: formatValue(41, 0), units: "applications" });
		for (const line of [lbs, acres, apps, "Pounds Applied", "Acres Treated", "Applications"])
			expect(text).toContain(line);
		// The shown figure first, then the catalog's order.
		expect(text.indexOf(lbs)).toBeLessThan(text.indexOf(acres));
		expect(text.indexOf(acres)).toBeLessThan(text.indexOf(apps));
		await expect
			.element(screen.getByText(m.map_use_card_sections({ count: "36", countValue: 36 })))
			.toBeVisible();
	});

	it("the shown figure leads, and zero has no class", async () => {
		const screen = await card({ figure: "applications", props: township({ applications: 0 }) });
		const text = screen.container.textContent ?? "";
		expect(text.indexOf("Applications")).toBeLessThan(text.indexOf("Pounds Applied"));
		expect(text).not.toContain("Shade");
	});

	it("the hover form has nothing focusable", async () => {
		const screen = await card({ interactive: false });
		await expect.element(screen.getByText("MDM-T15S-R20E")).toBeVisible();
		expect(focusables(screen.container)).toHaveLength(0);
		expect(screen.container.querySelector("button")).toBeNull();
	});

	it("has no axe violations, in both forms", async () => {
		for (const interactive of [true, false]) {
			const screen = await card({ interactive, filtersLine: "Sulfur" });
			const results = await axe.run(screen.container);
			expect(results.violations).toEqual([]);
			screen.unmount();
		}
	});
});

/** A data source holding `features` (the latest props by refKey come from these). */
function sourceOf(features: UseProps[]): DataSource<UseProps> & { set(f: UseProps[]): void } {
	// Reactive, as the use block's sources are.
	const held = new SvelteMap([[0, features]]);
	return {
		status: "ready",
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
		set(f: UseProps[]) {
			held.set(0, f);
		}
	} as never;
}

const item = (props: UseProps): FeatureListItem =>
	({ refKey: props.refKey, name: props.name, lngLat: [-120.1, 36.6] }) as FeatureListItem;

type Tooltip = (item: FeatureListItem, props: UseProps, env: unknown) => Snippet | undefined;

describe("the use plugins' cards", () => {
	let map: FakeMap;
	let townships: ReturnType<typeof sourceOf>;

	async function layers() {
		map = new FakeMap();
		// The focus area the use plugins go under.
		map.addPlugin({ id: "focus", kind: "focus", options: {} });
		townships = sourceOf([township()]);
		fakeLenses.length = 0;
		await render(UseLayers, {
			map: map as unknown as MapContext,
			townships,
			sections: sourceOf([]),
			lensSource: sourceOf([]),
			block: () => [],
			parentOf: () => null,
			label: "Pounds Applied, 2023",
			units: "lbs",
			zoom: 12,
			queryKey: "q",
			query: {
				figure: "pounds-applied",
				period: PERIOD,
				filters: {},
				info: FIGURES[0]
			},
			figures: FIGURES,
			drawn: true,
			loads: true,
			note: createRawSnippet(() => ({ render: () => "<p></p>" })),
			onlens: () => {}
		});
		const tooltip = (id: string) =>
			map.plugins.find((p) => p.id === id)?.options.tooltip as Tooltip | undefined;
		await expect.poll(() => tooltip("townships")).toBeDefined();
		return tooltip;
	}

	beforeEach(() => {
		fakeLenses.length = 0;
	});

	it("every use plugin draws its own name in the card", async () => {
		await layers();
		for (const id of ["townships", "lens", "sections"]) {
			const plugin = map.plugins.find((p) => p.id === id)!;
			expect(plugin.options.tooltipShowsName).toBe(true);
			expect(plugin.options.tooltip).toBeTypeOf("function");
		}
	});

	it("Show square miles pins the lens on that township", async () => {
		const tooltip = await layers();
		map.pinned = { hit: { pluginId: "townships", refKey: REF, name: "MDM-T15S-R20E" } };
		const lens = fakeLenses[0] as FakeLens;
		const pin = vi.spyOn(lens, "pin");
		const snippet = tooltip("townships")!(item(township()), township(), { scale: SCALE })!;
		const screen = await render(RenderSnippet, { snippet });
		await screen.getByRole("button", { name: m.map_use_card_show_sections() }).click();
		expect(pin).toHaveBeenCalledWith(REF);
	});

	it("Zoom in eases to the township at the section zoom", async () => {
		const tooltip = await layers();
		map.pinned = { hit: { pluginId: "townships", refKey: REF, name: "MDM-T15S-R20E" } };
		const snippet = tooltip("townships")!(item(township()), township(), { scale: SCALE })!;
		const screen = await render(RenderSnippet, { snippet });
		await screen.getByRole("button", { name: m.map_use_card_zoom_in() }).click();
		expect(map.cameraCalls).toEqual([
			{ kind: "easeTo", target: { center: [-120.1, 36.6], minZoom: 12 } }
		]);
	});

	it("a hovered township's card is the static form", async () => {
		const tooltip = await layers();
		const snippet = tooltip("townships")!(item(township()), township(), { scale: SCALE })!;
		const screen = await render(RenderSnippet, { snippet });
		await expect.element(screen.getByText("MDM-T15S-R20E")).toBeVisible();
		expect(focusables(screen.container)).toHaveLength(0);
	});

	it("a refetch keeps the open card mounted and focus inside it", async () => {
		const tooltip = await layers();
		map.pinned = { hit: { pluginId: "townships", refKey: REF, name: "MDM-T15S-R20E" } };
		const first = tooltip("townships")!(item(township()), township(), { scale: SCALE })!;
		const screen = await render(RenderSnippet, { snippet: first });
		const button = screen.getByRole("button", { name: m.map_use_card_show_sections() });
		await userEvent.click(button);
		(button.element() as HTMLElement).focus();
		// The refetch: new properties for the same township.
		const next = township({ lbs_chemical: 7000, value: 7000 });
		townships.set([next]);
		flushSync();
		expect(tooltip("townships")!(item(next), next, { scale: SCALE })).toBe(first);
		await expect
			.element(
				screen.getByText(m.map_use_card_value({ value: formatValue(7000, 0), units: "lbs" }))
			)
			.toBeVisible();
		expect(document.activeElement).toBe(button.element());
	});
});

describe("useTooltips", () => {
	it("one snippet per township and form while mounted, a fresh one after it closes", async () => {
		const latest = new SvelteMap<string, UseProps>([[REF, township()]]);
		const tooltips = useTooltips({
			current: (refKey) => latest.get(refKey),
			scale: () => SCALE,
			figure: "pounds-applied",
			period: PERIOD,
			figures: FIGURES,
			filtersLine: () => null,
			onshow: () => {},
			onzoom: () => {}
		});
		const hover = tooltips(item(township()), township(), false)!;
		const open = tooltips(item(township()), township(), true)!;
		expect(open).not.toBe(hover);
		const screen = await render(RenderSnippet, { snippet: open });
		expect(tooltips(item(township()), township(), true)).toBe(open);
		screen.unmount();
		expect(tooltips(item(township()), township(), true)).not.toBe(open);
	});
});
