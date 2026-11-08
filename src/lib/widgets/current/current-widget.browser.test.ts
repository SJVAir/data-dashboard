import "../../../app.css";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { commands, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { DatasetAdapter, RegionResolver } from "$lib/data/adapters/registry";
import type { CatalogEntry, Level, MetadataSource } from "$lib/data/metadata";
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
import { animationsSettled } from "../../../test/animations";
import CurrentWidget from "./CurrentWidget.svelte";

declare module "vitest/browser" {
	interface BrowserCommands {
		setReducedMotion: (reduce: boolean | null) => Promise<void>;
	}
}

const fake = vi.hoisted(() => ({
	client: undefined as QueryClient | undefined,
	metadata: undefined as MetadataSource | undefined
}));
vi.mock("$lib/data", () => ({
	getQueryClient: () => fake.client!,
	getMetadata: () => fake.metadata!
}));

const HOUR = 3_600_000;
const LEVELS: Level[] = PM25_LEVELS.map((l) =>
	l.key === "moderate"
		? { ...l, guidance: "Unusually sensitive people should reduce exertion." }
		: l
);
const CATALOG: CatalogEntry[] = FIXTURE_CATALOG.map((d) => ({
	...d,
	entryTypes: d.entryTypes.map((e) => ({ ...e, precision: 1 }))
}));

/** Hourly points for monitor ids: the latest complete hour ended 6 minutes ago. */
function adapter(values: Record<string, [number, number]>): DatasetAdapter {
	return {
		id: "air-quality",
		async target(layer) {
			const id = layer.place?.kind === "monitor" ? layer.place.id : "";
			if (id === "gone") return { unavailable: "monitor-unlisted" };
			return { kind: "monitors", ids: [id] };
		},
		offered: (base) => base,
		async fetch(req) {
			const id = req.target.kind === "monitors" ? req.target.ids[0] : "";
			const [before, latest] = values[id] ?? [0, 0];
			const t = Date.now() - 6 * 60_000 - HOUR;
			const point = (at: number, mean: number) => ({
				t: at,
				mean,
				min: mean,
				max: mean,
				count: 60,
				partial: false
			});
			return {
				series: [{ place: `monitor:${id}`, points: [point(t - HOUR, before), point(t, latest)] }],
				places: [{ place: `monitor:${id}`, name: `Monitor ${id}` }],
				resolution: req.resolution,
				fromRaw: false,
				processor: null,
				fetchedAt: Date.now()
			};
		}
	};
}

let frame: HTMLDivElement;

beforeEach(async () => {
	await page.viewport(1280, 800);
	fake.metadata = fixtureMetadata({
		catalog: async () => CATALOG,
		levels: async (entryType) => (entryType === "pm25" ? LEVELS : [])
	});
	const regions: RegionResolver = { resolve: async () => "unsupported" };
	fake.client = createQueryClient({
		adapters: [adapter({ a: [27.1, 28.4], good: [4, 5], none: [0, 0] })],
		metadata: fake.metadata,
		regions
	});
	frame = document.createElement("div");
	frame.style.width = "320px";
	frame.style.height = "420px";
	document.body.appendChild(frame);
});

afterEach(() => frame.remove());

function currentWidget(id: string): WidgetInstance {
	return {
		id: crypto.randomUUID(),
		type: "current-conditions",
		title: null,
		rect: { x: 0, y: 0, w: 3, h: 4 },
		data: {
			layers: [{ dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id } }]
		}
	};
}

async function show(widget: WidgetInstance) {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	return render(CurrentWidget, {
		target: frame,
		props: { widget },
		context: new Map<unknown, unknown>([[APP_CONTEXT_KEY, app]])
	});
}

test("shows the value, unit, level, trend, guidance and source line", async () => {
	const widget = currentWidget("a");
	const screen = await show(widget);
	await expect.element(screen.getByText("28.4"), { timeout: 5000 }).toBeVisible();
	await expect.element(screen.getByText("µg/m³")).toBeVisible();
	await expect.element(screen.getByText("Moderate", { exact: true })).toBeVisible();
	await expect.element(screen.getByText(m.current_trend_rising())).toBeVisible();
	await expect
		.element(screen.getByText("Unusually sensitive people should reduce exertion."))
		.toBeVisible();
	await expect
		.element(
			screen.getByText(
				m.current_source_updated({ average: m.current_hourly_average(), minutes: "6" })
			)
		)
		.toBeVisible();
	expect(m.current_source_updated({ average: "Hourly average", minutes: "6" })).toBe(
		"Hourly average · updated 6 min ago"
	);
	await expect.poll(() => generatedTitle(widget.id)).toBe("PM2.5 · Monitor a");
});

test("a level with no guidance shows no guidance line", async () => {
	const screen = await show(currentWidget("good"));
	await expect.element(screen.getByText("5.0", { exact: true }), { timeout: 5000 }).toBeVisible();
	await expect.element(screen.getByText("Good", { exact: true })).toBeVisible();
	expect(frame.querySelector("[data-guidance]")).toBeNull();
});

test("a place with no hourly average says so", async () => {
	const none = createQueryClient({
		adapters: [
			{
				...adapter({}),
				async fetch(req) {
					return {
						series: [{ place: "monitor:none", points: [] }],
						places: [{ place: "monitor:none", name: "Monitor none" }],
						resolution: req.resolution,
						fromRaw: false,
						processor: null,
						fetchedAt: Date.now()
					};
				}
			}
		],
		metadata: fake.metadata!,
		regions: { resolve: async () => "unsupported" }
	});
	fake.client = none;
	const screen = await show(currentWidget("none"));
	await expect.element(screen.getByText(m.current_no_data()), { timeout: 5000 }).toBeVisible();
});

test("an unlisted monitor shows the no-longer-available card", async () => {
	const screen = await show(currentWidget("gone"));
	await expect
		.element(screen.getByText(m.widget_state_gone_title()), { timeout: 5000 })
		.toBeVisible();
});

test("a threshold mark shows the label and an outline in the level color", async () => {
	const widget = currentWidget("a");
	const moderate = LEVELS.find((l) => l.key === "moderate")!;
	setMark(widget.id, { level: moderate, at: Date.now(), pulse: 1 });
	const screen = await show(widget);
	await expect.element(screen.getByText(m.current_at_alert_level())).toBeVisible();
	const card = frame.querySelector<HTMLElement>("[data-mark]")!;
	expect(getComputedStyle(card).outlineColor).toBe("rgb(255, 255, 0)");
	setMark(widget.id, null);
	await expect.poll(() => frame.querySelector("[data-mark]")).toBeNull();
});

test("the pulse replays once with motion and not at all under reduced motion", async () => {
	const widget = currentWidget("a");
	const mark = {
		level: LEVELS.find((l) => l.key === "moderate")!,
		at: Date.now(),
		pulse: 1
	};
	setMark(widget.id, mark);
	await show(widget);
	await expect.poll(() => frame.querySelector("[data-mark]")).not.toBeNull();
	expect(frame.getAnimations({ subtree: true }).length).toBeGreaterThan(0);
	await animationsSettled(frame);
	await commands.setReducedMotion(true);
	try {
		setMark(widget.id, { ...mark, pulse: 2 });
		await expect
			.poll(() => frame.querySelector("[data-pulse]")?.getAttribute("data-pulse"))
			.toBe("2");
		expect(frame.getAnimations({ subtree: true })).toHaveLength(0);
	} finally {
		await commands.setReducedMotion(null);
		setMark(widget.id, null);
	}
});

test("has no axe violations", async () => {
	const widget = currentWidget("a");
	setMark(widget.id, {
		level: LEVELS.find((l) => l.key === "moderate")!,
		at: Date.now(),
		pulse: 1
	});
	const screen = await show(widget);
	await expect.element(screen.getByText("28.4"), { timeout: 5000 }).toBeVisible();
	const results = await axe.run(frame);
	expect(results.violations).toEqual([]);
	setMark(widget.id, null);
});
