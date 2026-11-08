import "../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { toast } from "svelte-sonner";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { DatasetAdapter } from "$lib/data/adapters/registry";
import type { CatalogEntry, MetadataSource } from "$lib/data/metadata";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import { FIXTURE_CATALOG, fixtureMetadata } from "$lib/data/testing/fixtures";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform, type MemoryPlatform } from "$lib/platform/memory";
import { Toaster } from "$lib/components/ui/sonner";
import { APP_CONTEXT_KEY, initApp, type AppContext } from "$lib/store/app.svelte";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { OUTSIDE_TYPE } from "$lib/widgets/outside";
import { PM25_LEVELS } from "$lib/widgets/shared/test-harness/fake-data";
import Harness from "$lib/components/dashboard/test-harness/Harness.svelte";
import { thresholdMarks, setMark } from "./marks.svelte";
import { setNotifyEnabled } from "./notify-pref";
import ConditionsProbe from "./test-harness/ConditionsProbe.svelte";
import ThresholdWatcher from "./ThresholdWatcher.svelte";
import { readTold } from "./told";

const fake = vi.hoisted(() => ({
	client: undefined as QueryClient | undefined,
	metadata: undefined as MetadataSource | undefined
}));
vi.mock("$lib/data", () => ({
	getQueryClient: () => fake.client!,
	getMetadata: () => fake.metadata!
}));

const HOUR = 3_600_000;
const CATALOG: CatalogEntry[] = FIXTURE_CATALOG.map((d) => ({
	...d,
	entryTypes: d.entryTypes.map((e) => ({ ...e, precision: 1 }))
}));
const USG = "Unhealthy for Sensitive Groups";

/**
 * The hourly series the fake adapter serves: `values[i]` is the mean of the latest complete hour
 * after `step` polls. Each step's latest hour is `STEP` later, ending 6 minutes before now at the
 * last step, so each step is a new reading (and none is stale).
 */
const STEP = 10 * 60_000;
const series = { values: [20], step: 0 };
let t0 = Date.now();
let fetches = 0;

function adapter(): DatasetAdapter {
	return {
		id: "air-quality",
		async target(layer) {
			const id = layer.place?.kind === "monitor" ? layer.place.id : "";
			return { kind: "monitors", ids: [id] };
		},
		offered: (base) => base,
		async fetch(req) {
			fetches++;
			const id = req.target.kind === "monitors" ? req.target.ids[0] : "";
			const step = Math.min(series.step, series.values.length - 1);
			const latest = t0 - 6 * 60_000 - HOUR - (series.values.length - 1 - step) * STEP;
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
						points: [point(latest - HOUR, 5), point(latest, series.values[step])]
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

let levelsFail = false;
let levelCalls = 0;

beforeEach(async () => {
	t0 = Date.now();
	fetches = 0;
	levelsFail = false;
	levelCalls = 0;
	await page.viewport(1280, 800);
	fake.metadata = fixtureMetadata({
		catalog: async () => CATALOG,
		levels: async (entryType) => {
			levelCalls++;
			if (levelsFail) throw new Error("levels down");
			return entryType === "pm25" ? PM25_LEVELS : [];
		}
	});
	fake.client = createQueryClient({
		adapters: [adapter()],
		metadata: fake.metadata,
		regions: { resolve: async () => "unsupported" }
	});
});

afterEach(() => {
	toast.dismiss();
	for (const id of Object.keys(thresholdMarks)) setMark(id, null);
});

/** Polls every entry once more, as the poller does on the hour, after moving to the next step. */
function nextPoll(): void {
	series.step++;
	for (const e of fake.client!.entries()) fake.client!.refetch(e.key);
}

function tile(
	id: string,
	extra: Partial<WidgetInstance> = {},
	type = "current-conditions"
): WidgetInstance {
	return {
		id,
		type,
		title: `Tile ${id}`,
		rect: { x: 0, y: 0, w: 3, h: 5 },
		data: {
			layers: [{ dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id: "a" } }]
		},
		thresholds: [{ level: "unhealthy_sensitive" }],
		...extra
	};
}

async function seed(widgets: WidgetInstance[], platform: MemoryPlatform = createMemoryPlatform()) {
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const id = await app.index.createBlank();
	const stored = (await platform.documents.get(app.space, id)) as Dashboard;
	await platform.documents.commit(app.space, {
		docId: id,
		baseVersion: stored.version,
		doc: { ...stored, body: { widgets } },
		entries: []
	});
	const session = (await DocumentSession.open(platform, app.space, id, "t2"))!;
	app.current = { session, isStarter: false };
	await render(Harness, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	return { app, session, platform, docId: id };
}

const toasts = () => Array.from(document.querySelectorAll("[data-sonner-toast]"));
/** The toasts' texts (the live region says the same words, so `getByText` would match twice). */
const toastTexts = () => toasts().map((t) => t.textContent?.trim());
const watcherLive = () => document.querySelector("[data-threshold-announcer]")?.textContent ?? "";
const crossing = m.threshold_reached({ pollutant: "PM2.5", place: "Monitor a", level: USG });

/** Waits until this browser has stored "last told" for `widgetId` (its reading was handled). */
async function handled(
	p: MemoryPlatform,
	app: AppContext,
	docId: string,
	widgetId: string,
	at?: number
) {
	await expect
		.poll(async () => (await readTold(p, app.space, docId))[widgetId]?.at, { timeout: 5000 })
		.toSatisfy((told) => (at === undefined ? typeof told === "number" : told === at));
}

const readingAt = (step: number) => t0 - 6 * 60_000 - (series.values.length - 1 - step) * STEP;

test("the first reading at the level shows the mark but no toast", async () => {
	series.values = [40];
	series.step = 0;
	const { app, platform, docId } = await seed([tile("w1")]);
	await handled(platform, app, docId, "w1");
	await expect.poll(() => thresholdMarks.w1?.level.key).toBe("unhealthy_sensitive");
	expect(thresholdMarks.w1.pulse).toBe(0);
	await expect.element(page.getByText(m.current_at_alert_level())).toBeVisible();
	expect(toasts()).toHaveLength(0);
	expect(watcherLive()).toBe("");
});

test("a crossing toasts once and announces politely", async () => {
	series.values = [20, 40];
	series.step = 0;
	const { app, platform, docId } = await seed([tile("w1")]);
	await handled(platform, app, docId, "w1", readingAt(0));
	expect(thresholdMarks.w1).toBeUndefined();
	nextPoll();
	await expect.poll(toastTexts).toEqual([crossing]);
	expect(crossing).toBe(`PM2.5 at Monitor a is now ${USG}`);
	await expect.poll(watcherLive).toBe(crossing);
	expect(thresholdMarks.w1.pulse).toBe(1);
	// The same reading polled again tells nothing new.
	const before = fetches;
	for (const e of fake.client!.entries()) fake.client!.refetch(e.key);
	await expect.poll(() => fetches).toBeGreaterThan(before);
	await new Promise((r) => setTimeout(r, 200));
	expect(toasts()).toHaveLength(1);
});

test("a minimized widget keeps watching and its taskbar entry shows the mark", async () => {
	series.values = [20, 40];
	series.step = 0;
	const { app, platform, docId } = await seed([tile("w1", { minimized: { order: 0 } })]);
	await handled(platform, app, docId, "w1", readingAt(0));
	// Its entry still polls although no tile shows it.
	expect(fake.client!.entries().map((e) => e.polling)).toEqual([true]);
	const restore = page.getByRole("button", { name: "Restore Tile w1", exact: true });
	await expect.element(restore).toBeVisible();
	nextPoll();
	await expect.poll(toastTexts).toEqual([crossing]);
	const marked = page.getByRole("button", {
		name: m.taskbar_restore_named_at_alert_level({ title: "Tile w1" })
	});
	await expect.element(marked).toBeVisible();
	const entry = document.querySelector<HTMLElement>('[data-testid="taskbar-w1"]')!;
	expect(entry.hasAttribute("data-mark")).toBe(true);
	await expect.poll(() => getComputedStyle(entry).outlineColor).toBe("rgb(255, 126, 0)");
	expect(entry.querySelector("[data-mark-icon]")).not.toBeNull();
	expect(entry.querySelector("[data-pulse]")).not.toBeNull();
});

test("two watchers for one dashboard (two tabs) fire once", async () => {
	series.values = [20, 40];
	series.step = 0;
	const platform = createMemoryPlatform();
	const apps = await Promise.all(
		["t1", "t2"].map((tabId) =>
			initApp(platform, { channel: createMemoryTabHub().channel(), tabId })
		)
	);
	const docId = "doc-1";
	await render(Toaster);
	for (const app of apps) {
		await render(ThresholdWatcher, {
			props: { docId, widgets: [tile("w1")], space: app.space },
			context: new Map([[APP_CONTEXT_KEY, app]])
		});
	}
	await handled(platform, apps[0], docId, "w1", readingAt(0));
	nextPoll();
	await handled(platform, apps[0], docId, "w1", readingAt(1));
	await expect.poll(toastTexts).toEqual([crossing]);
	await new Promise((r) => setTimeout(r, 300));
	expect(toasts()).toHaveLength(1);
});

test("turning the threshold Off clears the mark and never fires", async () => {
	series.values = [40, 60];
	series.step = 0;
	const { app, platform, docId, session } = await seed([tile("w1"), tile("w2")]);
	await handled(platform, app, docId, "w1");
	await expect.poll(() => thresholdMarks.w1?.level.key).toBe("unhealthy_sensitive");
	const from = { name: session.doc.name, body: session.doc.body };
	const to = {
		name: session.doc.name,
		body: {
			widgets: session.doc.body.widgets.map((w) =>
				w.id === "w1" ? { ...w, thresholds: undefined } : w
			)
		}
	};
	session.apply({ op: "replaceDocument", target: {}, from, to });
	await expect.poll(() => thresholdMarks.w1).toBeUndefined();
	nextPoll();
	// w2 still watches: it fires; w1 doesn't, and its told entry is dropped.
	await expect
		.poll(toastTexts)
		.toEqual([m.threshold_reached({ pollutant: "PM2.5", place: "Monitor a", level: "Unhealthy" })]);
	await new Promise((r) => setTimeout(r, 200));
	expect(toasts()).toHaveLength(1);
	expect(Object.keys(await readTold(platform, app.space, docId))).toEqual(["w2"]);
});

test("a notification is shown only when the switch is on and permission granted", async () => {
	series.values = [20, 40, 60, 150];
	series.step = 0;
	const platform = createMemoryPlatform();
	const { app, docId } = await seed([tile("w1")], platform);
	await handled(platform, app, docId, "w1", readingAt(0));

	// Granted, but the switch is off.
	platform.notifications.script("granted");
	await platform.notifications.request();
	nextPoll();
	await handled(platform, app, docId, "w1", readingAt(1));
	await expect.poll(() => toasts().length).toBe(1);
	expect(platform.notifications.shown).toEqual([]);

	// The switch is on, but permission is denied (memory shows nothing unless granted, so check
	// the watcher didn't ask to: `shown` stays empty either way).
	await setNotifyEnabled(platform, app.space, docId, true);
	platform.notifications.script("denied");
	await platform.notifications.request();
	const show = vi.spyOn(platform.notifications, "show");
	nextPoll(); // 60: Unhealthy, worse than told
	await handled(platform, app, docId, "w1", readingAt(2));
	await expect.poll(() => toasts().length).toBe(2);
	expect(show).not.toHaveBeenCalled();

	// On and granted.
	platform.notifications.script("granted");
	await platform.notifications.request();
	nextPoll(); // 150: Very Unhealthy
	await handled(platform, app, docId, "w1", readingAt(3));
	const body = m.threshold_reached({
		pollutant: "PM2.5",
		place: "Monitor a",
		level: "Very Unhealthy"
	});
	await expect
		.poll(() => platform.notifications.shown)
		.toEqual([{ title: "Tile w1", body, tag: `${docId}:w1` }]);
	show.mockRestore();
});

test("a Can we go outside? card is watched as PM2.5 whatever its saved entry type", async () => {
	series.values = [20, 40];
	series.step = 0;
	const w = tile("w1", { minimized: { order: 0 } }, OUTSIDE_TYPE);
	w.data.layers[0].entryType = "o3";
	const { app, platform, docId } = await seed([w]);
	await handled(platform, app, docId, "w1", readingAt(0));
	nextPoll();
	await expect.poll(toastTexts).toEqual([crossing]);
});

// --- CurrentConditions (the tiles' and the watcher's reading) ---

async function probe(widget: WidgetInstance, polling?: () => boolean) {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	const seen: { current?: import("$lib/widgets/shared/current.svelte").CurrentConditions } = {};
	await render(ConditionsProbe, {
		props: { widget, polling, onready: (c) => (seen.current = c) },
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
	return seen;
}

test("CurrentConditions holds loading until the levels are in, then reads the latest hour", async () => {
	series.values = [28.4];
	series.step = 0;
	const seen = await probe(tile("w1"));
	const c = seen.current!;
	await expect.poll(() => c.state, { timeout: 5000 }).toBe("ready");
	expect(c.levels).toEqual(PM25_LEVELS);
	expect(c.meta?.entryType.id).toBe("pm25");
	// The catalog arriving after the first read still reaches readers.
	await expect.poll(() => document.querySelector("[data-probe-meta]")?.textContent).toBe("PM2.5");
	const r = c.reading;
	expect(r?.status).toBe("ok");
	if (r?.status !== "ok") return;
	expect(r.value).toBe(28.4);
	expect(r.level?.key).toBe("moderate");
	expect(r.at).toBe(readingAt(0));
	expect(r.trend).toBe("rising");
	expect(r.place.name).toBe("Monitor a");
});

test("CurrentConditions reports failed levels as an error and Retry loads them again", async () => {
	series.values = [28.4];
	series.step = 0;
	levelsFail = true;
	const seen = await probe(tile("w1"));
	const c = seen.current!;
	await expect.poll(() => c.state, { timeout: 5000 }).toBe("error");
	expect(c.shown.status).toBe("error");
	expect(c.reading).toBeUndefined();
	levelsFail = false;
	const calls = levelCalls;
	c.retry();
	await expect.poll(() => c.state).toBe("ready");
	expect(levelCalls).toBe(calls + 1);
	expect(c.reading?.status).toBe("ok");
});

test("CurrentConditions polls unless minimized, and opts.polling overrides it", async () => {
	series.values = [28.4];
	series.step = 0;
	const minimized = tile("w1", { minimized: { order: 0 } });
	const a = await probe(minimized);
	await expect.poll(() => a.current!.state, { timeout: 5000 }).toBe("ready");
	expect(fake.client!.entries().map((e) => e.polling)).toEqual([false]);
	await probe(minimized, () => true);
	await expect.poll(() => fake.client!.entries().map((e) => e.polling)).toEqual([true]);
});
