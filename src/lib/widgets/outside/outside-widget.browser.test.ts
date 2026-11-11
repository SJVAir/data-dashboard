import "../../../app.css";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { DatasetAdapter, AdapterContext } from "$lib/data/adapters/registry";
import type { CatalogEntry, Level, MetadataSource } from "$lib/data/metadata";
import { createNowClient, type NowClient } from "$lib/data/now/client";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import { FIXTURE_CATALOG, fixtureMetadata } from "$lib/data/testing/fixtures";
import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { setMark } from "$lib/thresholds/marks.svelte";
import { PM25_LEVELS } from "../shared/test-harness/fake-data";
import { generatedTitle } from "../titles.svelte";
import OutsideWidget from "./OutsideWidget.svelte";

const fake = vi.hoisted(() => ({
	query: undefined as QueryClient | undefined,
	now: undefined as NowClient | undefined,
	metadata: undefined as MetadataSource | undefined,
	heat: undefined as (() => Promise<unknown>) | undefined
}));
vi.mock("$lib/data", () => ({
	getQueryClient: () => fake.query!,
	getMetadata: () => fake.metadata!,
	getResolvers: (): Pick<AdapterContext, "regions" | "locations" | "points"> => ({
		regions: { resolve: async () => "unsupported" },
		locations: { resolve: async () => null },
		points: { keys: async () => [] }
	})
}));
vi.mock("$lib/data/now", () => ({ getNowClient: () => fake.now! }));
vi.mock("@sjvair/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@sjvair/sdk")>()),
	getHeatForPlace: () => fake.heat!()
}));

const HOUR = 3_600_000;
const LEVELS: Level[] = PM25_LEVELS;
const CATALOG: CatalogEntry[] = FIXTURE_CATALOG.map((d) => ({
	...d,
	entryTypes: d.entryTypes.map((e) => ({ ...e, precision: 1 }))
}));
const HEAT_LEVELS: Level[] = [
	heatLevel("0", "Low", ""),
	heatLevel("3", "Severe", "Avoid strenuous activity outdoors. Stay in a cool place, drink water.")
];
const GUIDELINES = {
	label: "Outdoor Activity Guidelines for Schools",
	resolution: "hour",
	source: { name: "Outdoor Activity Guidelines for Schools", url: "https://guidelines.example" },
	activities: [
		{
			key: "recess",
			label: "Recess",
			duration: null,
			levels: { unhealthy_sensitive: ["Keep recess short.", "Offer indoor options."] }
		},
		{
			key: "athletics",
			label: "Athletics",
			duration: "Practice",
			levels: {
				unhealthy_sensitive: ["Move practice indoors if you can.", "Watch players with asthma."]
			}
		}
	]
} as never;

function heatLevel(value: string, label: string, guidance: string): Level {
	return {
		key: label.toLowerCase(),
		label,
		color: "#888888",
		opacity: null,
		tier: null,
		guidance,
		description: "",
		min: 0,
		max: null,
		value
	};
}

function adapter(values: Record<string, number | null>): DatasetAdapter {
	return {
		id: "air-quality",
		async target(layer) {
			return { kind: "monitors", ids: [layer.place?.kind === "monitor" ? layer.place.id : ""] };
		},
		offered: (base) => base,
		async fetch(req) {
			const id = req.target.kind === "monitors" ? req.target.ids[0] : "";
			const value = values[id] ?? null;
			const t = Date.now() - 6 * 60_000 - HOUR - (id === "old" ? 5 * HOUR : 0);
			const point = (at: number, mean: number) => ({
				t: at,
				mean,
				min: mean,
				max: mean,
				count: 60,
				partial: false
			});
			return {
				series: [
					{
						place: `monitor:${id}`,
						points: value === null ? [] : [point(t - HOUR, value), point(t, value)]
					}
				],
				places: [{ place: `monitor:${id}`, name: `Monitor ${id}` }],
				resolution: req.resolution,
				fromRaw: false,
				processor: null,
				fetchedAt: Date.now()
			};
		}
	};
}

function heatResponse(score: number, zipCount = 1) {
	const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(
		new Date()
	);
	return {
		place: {},
		zip_count: zipCount,
		days: [{ date, score, score_display: String(score), zipcode: "93210" }]
	};
}

let frame: HTMLDivElement;

beforeEach(async () => {
	await page.viewport(1280, 800);
	fake.metadata = fixtureMetadata({
		catalog: async () => CATALOG,
		levels: async (entryType) => (entryType === "pm25" ? LEVELS : []),
		datasetLevels: async (dataset, entryType) =>
			dataset === "calheatscore" ? HEAT_LEVELS : entryType === "pm25" ? LEVELS : [],
		schoolGuidelines: async () => GUIDELINES,
		monitors: async () =>
			["usg", "good", "none", "old"].map((id) => ({
				id,
				name: `Monitor ${id}`,
				type: "purpleair"
			})) as never
	});
	fake.query = createQueryClient({
		adapters: [adapter({ usg: 40, good: 5, none: null, old: 40 })],
		metadata: fake.metadata,
		regions: { resolve: async () => "unsupported" }
	});
	fake.now = createNowClient();
	fake.heat = async () => heatResponse(3);
	frame = document.createElement("div");
	frame.style.width = "320px";
	frame.style.height = "540px";
	document.body.appendChild(frame);
});

afterEach(() => frame.remove());

function outsideWidget(id: string, entryType = "pm25"): WidgetInstance {
	return {
		id: crypto.randomUUID(),
		type: "outside",
		title: null,
		rect: { x: 0, y: 0, w: 3, h: 7 },
		data: {
			layers: [{ dataset: "air-quality", entryType, place: { kind: "monitor", id } }]
		}
	};
}

async function show(widget: WidgetInstance) {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	return render(OutsideWidget, {
		target: frame,
		props: { widget },
		context: new Map<unknown, unknown>([[APP_CONTEXT_KEY, app]])
	});
}

test("shows the level and each activity's first sentence, and the source link", async () => {
	const widget = outsideWidget("usg");
	const screen = await show(widget);
	await expect
		.element(screen.getByText("Unhealthy for Sensitive Groups", { exact: true }), { timeout: 5000 })
		.toBeVisible();
	await expect.element(screen.getByText("Keep recess short.")).toBeVisible();
	await expect.element(screen.getByText("Move practice indoors if you can.")).toBeVisible();
	expect(screen.getByText("Watch players with asthma.").elements()).toHaveLength(0);
	await expect.element(screen.getByText("Practice", { exact: true })).toBeVisible();
	const link = screen.getByRole("link", {
		name: new RegExp(m.source_named({ name: "Outdoor Activity Guidelines for Schools" }))
	});
	await expect.element(link).toBeVisible();
	await expect.poll(() => generatedTitle(widget.id)).toBe("Can we go outside? · Monitor usg");
});

test("a saved layer for another pollutant still reads PM2.5", async () => {
	const screen = await show(outsideWidget("usg", "o3"));
	await expect.element(screen.getByText("Keep recess short."), { timeout: 5000 }).toBeVisible();
});

test("an activity's button is named by the activity, not its preview sentence", async () => {
	const screen = await show(outsideWidget("usg"));
	const button = screen.getByRole("button", { name: /Athletics/ });
	await expect.element(button, { timeout: 5000 }).toBeVisible();
	const el = button.element() as HTMLButtonElement;
	expect(el.textContent).not.toContain("Keep recess short");
	expect(el.textContent?.replace(/\s+/g, " ").trim()).toMatch(/^Athletics/);
	const preview = (el.getRootNode() as Document).getElementById(
		el.getAttribute("aria-describedby")!
	);
	expect(preview?.textContent?.trim()).toBeTruthy();
});

test("opening Athletics shows both sentences and sets aria-expanded", async () => {
	const screen = await show(outsideWidget("usg"));
	const button = screen.getByRole("button", { name: /Athletics/ });
	await expect.element(button, { timeout: 5000 }).toHaveAttribute("aria-expanded", "false");
	await button.click();
	await expect.element(button).toHaveAttribute("aria-expanded", "true");
	await expect.element(screen.getByText("Move practice indoors if you can.")).toBeVisible();
	await expect.element(screen.getByText("Watch players with asthma.")).toBeVisible();
	await button.click();
	await expect.element(button).toHaveAttribute("aria-expanded", "false");
});

test("severe heat's full guidance is visible, not clipped, at the default size", async () => {
	const screen = await show(outsideWidget("usg"));
	await expect.element(screen.getByText(m.outside_heat_today()), { timeout: 5000 }).toBeVisible();
	await expect.element(screen.getByText("Severe", { exact: true })).toBeVisible();
	const guidance = frame.querySelector<HTMLElement>("[data-heat-guidance]")!;
	expect(guidance.textContent).toContain("drink water.");
	const heat = frame.querySelector<HTMLElement>("[data-heat]")!;
	expect(heat.scrollHeight).toBeLessThanOrEqual(heat.clientHeight);
	expect(guidance.scrollHeight).toBeLessThanOrEqual(guidance.clientHeight);
	// The card has room for the whole footer.
	expect(heat.getBoundingClientRect().bottom).toBeLessThanOrEqual(
		frame.getBoundingClientRect().bottom
	);
});

test("the activity list scrolls on a small tile while the heat section keeps its room", async () => {
	frame.style.height = "260px";
	const screen = await show(outsideWidget("usg"));
	await expect
		.element(screen.getByText("Severe", { exact: true }), { timeout: 5000 })
		.toBeVisible();
	const heat = frame.querySelector<HTMLElement>("[data-heat]")!;
	expect(heat.scrollHeight).toBeLessThanOrEqual(heat.clientHeight);
	expect(heat.getBoundingClientRect().bottom).toBeLessThanOrEqual(
		frame.getBoundingClientRect().bottom
	);
});

test("low heat shows just Heat today and Low", async () => {
	fake.heat = async () => heatResponse(0);
	const screen = await show(outsideWidget("usg"));
	await expect.element(screen.getByText("Low", { exact: true }), { timeout: 5000 }).toBeVisible();
	await expect.element(screen.getByText(m.outside_heat_today())).toBeVisible();
	expect(frame.querySelector("[data-heat-guidance]")).toBeNull();
});

test("a place covering several ZIPs names the highest", async () => {
	fake.heat = async () => heatResponse(3, 12);
	const screen = await show(outsideWidget("usg"));
	// A monitor's own place is named by the monitor: the label still carries the ZIP.
	await expect
		.element(screen.getByText(/Highest in Monitor usg \(ZIP 93210\)/), { timeout: 5000 })
		.toBeVisible();
});

test("a level with no sentences says there is no guidance, never another level's text", async () => {
	const screen = await show(outsideWidget("good"));
	await expect.element(screen.getByText("Good", { exact: true }), { timeout: 5000 }).toBeVisible();
	expect(screen.getByText(m.outside_no_guidance_for_level()).elements()).toHaveLength(2);
	expect(screen.getByText("Keep recess short.").elements()).toHaveLength(0);
});

test("no PM2.5 says so and keeps the heat line", async () => {
	const screen = await show(outsideWidget("none"));
	await expect.element(screen.getByText(m.outside_no_pm25()), { timeout: 5000 }).toBeVisible();
	await expect.element(screen.getByText(m.outside_heat_today()), { timeout: 5000 }).toBeVisible();
	await expect.element(screen.getByText("Severe", { exact: true })).toBeVisible();
});

test("a stale reading says there is no recent data and keeps the heat line", async () => {
	const screen = await show(outsideWidget("old"));
	await expect
		.element(screen.getByText(m.current_no_recent_data()), { timeout: 5000 })
		.toBeVisible();
	expect(screen.getByText(m.outside_no_pm25()).elements()).toHaveLength(0);
	await expect.element(screen.getByText("Severe", { exact: true })).toBeVisible();
});

test("a heat failure leaves the air quality part and says there is no heat score", async () => {
	fake.heat = async () => {
		throw new Error("boom");
	};
	const screen = await show(outsideWidget("usg"));
	await expect.element(screen.getByText("Keep recess short."), { timeout: 5000 }).toBeVisible();
	await expect.element(screen.getByText(m.outside_heat_load_failed())).toBeVisible();
	expect(screen.getByText(m.outside_no_heat_score_today()).elements()).toHaveLength(0);
});

test("a threshold mark shows the strip and the outline", async () => {
	const widget = outsideWidget("usg");
	setMark(widget.id, { level: LEVELS[2], at: Date.now(), pulse: 1 });
	const screen = await show(widget);
	await expect
		.element(screen.getByText(m.current_alert_level_reached()), { timeout: 5000 })
		.toBeVisible();
	expect(frame.querySelector("[data-mark]")).not.toBeNull();
});

test("has no axe violations", async () => {
	const screen = await show(outsideWidget("usg"));
	await expect
		.element(screen.getByText("Severe", { exact: true }), { timeout: 5000 })
		.toBeVisible();
	const results = await axe.run(frame);
	expect(results.violations).toEqual([]);
});
