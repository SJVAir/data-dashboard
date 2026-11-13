import "../../../app.css";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { commands, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { DatasetAdapter, RegionResolver } from "$lib/data/adapters/registry";
import type { CatalogEntry, Level, MetadataSource } from "$lib/data/metadata";
import type { AlertRecord } from "$lib/data/now/alert";
import { createNowClient, type NowClient } from "$lib/data/now/client";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import { FIXTURE_CATALOG, fixtureMetadata } from "$lib/data/testing/fixtures";
import type { WidgetInstance } from "$lib/documents/schema";
import { formatDate } from "$lib/format";
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
	metadata: undefined as MetadataSource | undefined,
	now: undefined as NowClient | undefined,
	/** What the alert endpoint answers for each monitor id; each call is counted. */
	alerts: {} as Record<string, AlertRecord>,
	alertCalls: [] as string[],
	/** Monitor ids whose alert fetch rejects. */
	alertFail: new Set<string>(),
	/** Makes alert fetches never answer. */
	alertHang: false,
	/** What the hourly fetch does for a monitor id: reject, or never answer. */
	hourly: {} as Record<string, "fail" | "hang">,
	hourlyCalls: 0,
	/** Makes the next scale (levels) lookup reject. */
	levelsFail: false
}));
vi.mock("$lib/data", () => ({
	getQueryClient: () => fake.client!,
	getMetadata: () => fake.metadata!
}));

vi.mock("$lib/data/now", () => ({ getNowClient: () => fake.now! }));
vi.mock("$lib/data/now/alert", async (original) => ({
	...(await original<typeof import("$lib/data/now/alert")>()),
	alertSource: (id: string) => ({
		key: `alert:${id}`,
		cadence: "raw" as const,
		fetch: async () => {
			fake.alertCalls.push(id);
			if (fake.alertHang) await new Promise(() => {});
			if (fake.alertFail.has(id)) throw new Error("alert failed");
			return fake.alerts[id] ?? {};
		}
	})
}));

const HOUR = 3_600_000;
/** When the test began: the latest complete hour ended 6 minutes before it. */
let t0 = Date.now();
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
			const place = layer.place;
			// A region stands in as the monitor named by its code.
			const id = place?.kind === "monitor" ? place.id : place?.kind === "region" ? place.code : "";
			if (id === "gone") return { unavailable: "monitor-unlisted" };
			return { kind: "monitors", ids: [id] };
		},
		offered: (base) => base,
		async fetch(req) {
			const id = req.target.kind === "monitors" ? req.target.ids[0] : "";
			fake.hourlyCalls++;
			if (fake.hourly[id] === "fail") throw new Error("hourly failed");
			if (fake.hourly[id] === "hang") await new Promise(() => {});
			const [before, latest] = values[id] ?? [0, 0];
			const t = t0 - 6 * 60_000 - HOUR;
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
	t0 = Date.now();
	await page.viewport(1280, 800);
	fake.now = createNowClient();
	fake.alerts = {};
	fake.alertCalls = [];
	fake.alertFail = new Set();
	fake.alertHang = false;
	fake.hourly = {};
	fake.hourlyCalls = 0;
	fake.levelsFail = false;
	fake.metadata = fixtureMetadata({
		catalog: async () => CATALOG,
		levels: async (entryType) => {
			if (fake.levelsFail) {
				fake.levelsFail = false;
				throw new Error("levels failed");
			}
			return entryType === "pm25" ? LEVELS : [];
		},
		monitorType: async (id) =>
			({ "m-pa": "purpleair", "m-bam": "bam1022", voz: "vozbox", "m-x": "purpleair" })[id] ?? null,
		monitors: async () => [
			{ id: "m-pa", name: "PA", type: "purpleair", county: "Fresno", active: true, inside: false },
			{ id: "m-bam", name: "BAM", type: "bam1022", county: "Fresno", active: true, inside: false },
			{ id: "voz", name: "VOZ", type: "vozbox", county: "Fresno", active: true, inside: false }
		]
	});
	const regions: RegionResolver = { resolve: async () => "unsupported" };
	fake.client = createQueryClient({
		adapters: [
			adapter({
				a: [27.1, 28.4],
				good: [4, 5],
				none: [0, 0],
				"m-pa": [20, 21],
				"m-bam": [20, 21],
				voz: [20, 21]
			})
		],
		metadata: fake.metadata,
		regions
	});
	frame = document.createElement("div");
	frame.style.width = "320px";
	frame.style.height = "420px";
	document.body.appendChild(frame);
});

afterEach(() => {
	vi.useRealTimers();
	frame.remove();
});

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
				m.current_source_updated_minutes({ average: m.current_hourly_average(), minutes: "6" })
			)
		)
		.toBeVisible();
	expect(m.current_source_updated_minutes({ average: "Hourly average", minutes: "6" })).toBe(
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
	await expect.element(screen.getByText(m.current_alert_level_reached())).toBeVisible();
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

test("an hour that has gone stale between polls becomes No recent data", async () => {
	vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
	const screen = await show(currentWidget("a"));
	await expect.element(screen.getByText("28.4"), { timeout: 5000 }).toBeVisible();
	await vi.advanceTimersByTimeAsync(3 * HOUR);
	await expect.element(screen.getByText(m.current_no_recent_data())).toBeVisible();
});

test("a retired entry type shows its note over the value", async () => {
	const retiredCatalog = CATALOG.map((d) => ({
		...d,
		entryTypes: d.entryTypes.map((e) =>
			e.id === "pm25" ? { ...e, retired: { since: "2025-01-02" } } : e
		)
	}));
	fake.metadata = fixtureMetadata({
		catalog: async () => retiredCatalog,
		levels: async (entryType) => (entryType === "pm25" ? LEVELS : [])
	});
	const screen = await show(currentWidget("a"));
	await expect.element(screen.getByText("28.4"), { timeout: 5000 }).toBeVisible();
	await expect
		.element(
			screen.getByText(
				m.widget_state_dataset_retired({ dataset: "PM2.5", date: formatDate("2025-01-02") })
			)
		)
		.toBeVisible();
});

test("a retired place shows its note over the value", async () => {
	const base = adapter({ a: [27.1, 28.4] });
	fake.client = createQueryClient({
		adapters: [
			{
				...base,
				async fetch(req, ctx, signal) {
					const data = await base.fetch(req, ctx, signal);
					return {
						...data,
						places: data.places.map((p) => ({
							...p,
							retired: { since: "2024-03-05", replacedBy: null }
						}))
					};
				}
			}
		],
		metadata: fake.metadata!,
		regions: { resolve: async () => "unsupported" }
	});
	const screen = await show(currentWidget("a"));
	await expect.element(screen.getByText("28.4"), { timeout: 5000 }).toBeVisible();
	await expect
		.element(
			screen.getByText(
				m.widget_state_place_retired({ place: "Monitor a", date: formatDate("2024-03-05") })
			)
		)
		.toBeVisible();
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

/** An alert result in the published shape; `over` replaces fields. */
function alertEntry(over: Record<string, unknown> = {}) {
	const at = new Date(Date.now() - 2 * 60_000).toISOString();
	return {
		status: "ok",
		value: 31.2,
		level: "moderate",
		window: { start: at, end: at },
		latest_timestamp: at,
		readings: 29,
		required: 15,
		previous: {
			status: "ok",
			value: 40.1,
			level: "unhealthy_for_sensitive_groups",
			latest_timestamp: new Date(Date.now() - 62 * 60_000).toISOString()
		},
		evaluated_at: at,
		...over
	};
}

test("a monitor the server evaluates reads the alert value as a 60-minute average", async () => {
	fake.alerts = { "m-pa": { pm25: alertEntry() } as never };
	const screen = await show(currentWidget("m-pa"));
	await expect.element(screen.getByText("31.2"), { timeout: 5000 }).toBeVisible();
	await expect.element(screen.getByText("Moderate", { exact: true })).toBeVisible();
	await expect.element(screen.getByText(m.current_trend_falling())).toBeVisible();
	await expect
		.element(
			screen.getByText(
				m.current_source_updated_minutes({
					average: m.current_minute_average({ minutes: 60 }),
					minutes: "2"
				})
			)
		)
		.toBeVisible();
	expect(fake.alertCalls).toEqual(["m-pa"]);
});

test("an hourly feed reads its latest reading", async () => {
	fake.alerts = { "m-bam": { pm25: alertEntry({ value: 12.5 }) } as never };
	const screen = await show(currentWidget("m-bam"));
	await expect.element(screen.getByText("12.5"), { timeout: 5000 }).toBeVisible();
	await expect
		.element(
			screen.getByText(
				m.current_source_updated_minutes({ average: m.current_latest_reading(), minutes: "2" })
			)
		)
		.toBeVisible();
});

test("a monitor the server does not evaluate reads the hourly average", async () => {
	const screen = await show(currentWidget("voz"));
	await expect.element(screen.getByText("21.0", { exact: true }), { timeout: 5000 }).toBeVisible();
	await expect
		.element(
			screen.getByText(
				m.current_source_updated_minutes({ average: m.current_hourly_average(), minutes: "6" })
			)
		)
		.toBeVisible();
	expect(fake.alertCalls).toEqual([]);
});

test("an alert result with no entry for the pollutant reads the hourly average", async () => {
	fake.alerts = { "m-pa": {} };
	const screen = await show(currentWidget("m-pa"));
	await expect.element(screen.getByText("21.0", { exact: true }), { timeout: 5000 }).toBeVisible();
	await expect
		.element(screen.getByText(m.current_hourly_average(), { exact: false }))
		.toBeVisible();
	expect(fake.alertCalls).toEqual(["m-pa"]);
});

test("a pending alert result says it is not available yet", async () => {
	const none = { value: null, level: null, window: null, latest_timestamp: null, previous: null };
	fake.alerts = { "m-pa": { pm25: alertEntry({ status: "pending", ...none }) } as never };
	const screen = await show(currentWidget("m-pa"));
	await expect
		.element(screen.getByText(m.current_not_available_yet()), { timeout: 5000 })
		.toBeVisible();
});

test("a region never asks for an alert value", async () => {
	const widget = currentWidget("a");
	widget.data.layers[0].place = { kind: "region", type: "county", code: "a" };
	const screen = await show(widget);
	await expect.element(screen.getByText("28.4"), { timeout: 5000 }).toBeVisible();
	expect(fake.alertCalls).toEqual([]);
});

test("the tile shows the alert value when the hourly query fails", async () => {
	fake.hourly = { "m-pa": "fail" };
	fake.alerts = { "m-pa": { pm25: alertEntry() } as never };
	const screen = await show(currentWidget("m-pa"));
	await expect.element(screen.getByText("31.2"), { timeout: 5000 }).toBeVisible();
	await expect.element(screen.getByText(m.widget_state_retry())).not.toBeInTheDocument();
});

test("the tile shows the alert value while the hourly query is still loading", async () => {
	fake.hourly = { "m-pa": "hang" };
	fake.alerts = { "m-pa": { pm25: alertEntry() } as never };
	const screen = await show(currentWidget("m-pa"));
	await expect.element(screen.getByText("31.2"), { timeout: 5000 }).toBeVisible();
});

test("a hourly failure with no alert entry still shows the error card", async () => {
	fake.hourly = { "m-pa": "fail" };
	fake.alerts = { "m-pa": {} };
	const screen = await show(currentWidget("m-pa"));
	await expect.element(screen.getByText(m.widget_state_retry()), { timeout: 5000 }).toBeVisible();
});

test("an alert fetch that fails with no data falls back to the hourly average", async () => {
	fake.alertFail.add("m-pa");
	const screen = await show(currentWidget("m-pa"));
	await expect.element(screen.getByText("21.0", { exact: true }), { timeout: 5000 }).toBeVisible();
	await expect
		.element(screen.getByText(m.current_hourly_average(), { exact: false }))
		.toBeVisible();
});

test("an alert config lookup that rejects falls back to the hourly average", async () => {
	const base = fake.metadata!;
	fake.metadata = {
		...base,
		alertConfig: async () => {
			throw new Error("meta failed");
		}
	};
	const screen = await show(currentWidget("m-pa"));
	await expect.element(screen.getByText("21.0", { exact: true }), { timeout: 5000 }).toBeVisible();
	expect(fake.alertCalls).toEqual([]);
});

test("a lookup that resolves after the place changed does not set the old monitor's mode", async () => {
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	const base = fake.metadata!;
	fake.metadata = {
		...base,
		monitorType: async (id, signal) => {
			if (id === "m-pa") await gate;
			return base.monitorType(id, signal);
		}
	};
	fake.alerts = { "m-pa": { pm25: alertEntry() } as never };
	const first = currentWidget("m-pa");
	const screen = await show(first);
	await screen.rerender({
		widget: {
			...first,
			data: { layers: [{ ...first.data.layers[0], place: { kind: "monitor", id: "voz" } }] }
		}
	});
	await expect.element(screen.getByText("21.0", { exact: true }), { timeout: 5000 }).toBeVisible();
	release();
	await new Promise((r) => setTimeout(r, 100));
	expect(fake.alertCalls).toEqual([]);
	await expect.element(screen.getByText("21.0", { exact: true })).toBeVisible();
});

test("Retry fetches again only what failed: the hourly query, not the alert", async () => {
	fake.hourly = { "m-pa": "fail" };
	fake.alerts = { "m-pa": {} };
	const screen = await show(currentWidget("m-pa"));
	await expect.element(screen.getByText(m.widget_state_retry()), { timeout: 5000 }).toBeVisible();
	expect(fake.alertCalls).toEqual(["m-pa"]);
	const hourly = fake.hourlyCalls;
	fake.hourly = {};
	await screen.getByText(m.widget_state_retry()).click();
	await expect.element(screen.getByText("21.0", { exact: true }), { timeout: 5000 }).toBeVisible();
	expect(fake.hourlyCalls).toBeGreaterThan(hourly);
	expect(fake.alertCalls).toEqual(["m-pa"]);
});

test("Retry after failed levels fetches neither query again", async () => {
	fake.alerts = { "m-pa": { pm25: alertEntry() } as never };
	fake.levelsFail = true;
	const screen = await show(currentWidget("m-pa"));
	await expect.element(screen.getByText(m.widget_state_retry()), { timeout: 5000 }).toBeVisible();
	const hourly = fake.hourlyCalls;
	await screen.getByText(m.widget_state_retry()).click();
	await expect.element(screen.getByText("31.2"), { timeout: 5000 }).toBeVisible();
	expect(fake.hourlyCalls).toBe(hourly);
	expect(fake.alertCalls).toEqual(["m-pa"]);
});

test("a monitor the list has no name for is called the unnamed place, not its id", async () => {
	fake.alerts = { "m-x": { pm25: alertEntry() } as never };
	const widget = currentWidget("m-x");
	await show(widget);
	await expect
		.poll(() => generatedTitle(widget.id), { timeout: 5000 })
		.toBe(`PM2.5 · ${m.place_picker_unnamed()}`);
	// And with the hourly query failed, so no hourly place names it.
	fake.hourly = { "m-x": "fail" };
	const other = currentWidget("m-x");
	await show(other);
	await expect
		.poll(() => generatedTitle(other.id), { timeout: 5000 })
		.toBe(`PM2.5 · ${m.place_picker_unnamed()}`);
});

test("a later alert retry in flight keeps the hourly value on the tile", async () => {
	fake.alertFail.add("m-pa");
	const screen = await show(currentWidget("m-pa"));
	await expect.element(screen.getByText("21.0", { exact: true }), { timeout: 5000 }).toBeVisible();
	// The poller's retry of the alert is on its way and slow: nothing flips to loading or empty.
	fake.alertHang = true;
	fake.now!.refetch("alert:m-pa");
	await expect.poll(() => fake.alertCalls.length).toBe(2);
	await new Promise((r) => setTimeout(r, 200));
	await expect.element(screen.getByText("21.0", { exact: true })).toBeVisible();
	expect(frame.querySelector("[data-skeleton], [aria-busy='true']")).toBeNull();
});
