import "../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { toast } from "svelte-sonner";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { DatasetAdapter } from "$lib/data/adapters/registry";
import type { CatalogEntry, MetadataSource } from "$lib/data/metadata";
import { createNowClient, type NowClient } from "$lib/data/now/client";
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
	metadata: undefined as MetadataSource | undefined,
	now: undefined as NowClient | undefined,
	/** The alert result for monitor `pa` (an entry's `value`, or no entry at all). */
	alertValue: undefined as number | undefined,
	alertCalls: 0
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
			fake.alertCalls++;
			if (fake.alertValue === undefined) return {};
			const at = new Date(Date.now() - 2 * 60_000).toISOString();
			return {
				pm25: {
					status: "ok",
					value: fake.alertValue,
					level: null,
					window: { start: at, end: at },
					latest_timestamp: at,
					readings: 29,
					required: 15,
					previous: null,
					evaluated_at: at
				}
			};
		}
	})
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
const series = {
	values: [20] as (number | null)[],
	step: 0,
	/** Makes the next fetches fail (the query keeps its last data). */
	fail: false,
	/** Makes the hourly fetch never answer. */
	hang: false
};
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
			if (series.fail) throw new Error("summaries down");
			if (series.hang) await new Promise(() => {});
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
						// null: no hourly value at all (the place has no data).
						points:
							series.values[step] === null
								? []
								: [point(latest - HOUR, 5), point(latest, series.values[step])]
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
	series.fail = false;
	series.hang = false;
	fake.now = createNowClient();
	fake.alertValue = undefined;
	fake.alertCalls = 0;
	fetches = 0;
	levelsFail = false;
	levelCalls = 0;
	await page.viewport(1280, 800);
	fake.metadata = fixtureMetadata({
		catalog: async () => CATALOG,
		monitorType: async (id) => (id === "pa" ? "purpleair" : null),
		monitors: async () => [
			{ id: "pa", name: "PA", type: "purpleair", county: "Fresno", active: true }
		],
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
const crossing = m.alert_pollutant_at_place_is_now_level({
	pollutant: "PM2.5",
	place: "Monitor a",
	level: USG
});

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
	await expect.element(page.getByText(m.current_alert_level_reached())).toBeVisible();
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
		name: m.taskbar_restore_named_alert_reached({ title: "Tile w1" })
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
	await expect.poll(toastTexts).toEqual([
		m.alert_pollutant_at_place_is_now_level({
			pollutant: "PM2.5",
			place: "Monitor a",
			level: "Unhealthy"
		})
	]);
	await new Promise((r) => setTimeout(r, 200));
	expect(toasts()).toHaveLength(1);
	expect(Object.keys(await readTold(platform, app.space, docId))).toEqual(["w2"]);
});

test("a threshold turned Off and back On while at the level starts afresh: no toast", async () => {
	series.values = [20, 40];
	series.step = 0;
	const { app, platform, docId, session } = await seed([tile("w1")]);
	await handled(platform, app, docId, "w1", readingAt(0));
	const setThreshold = (thresholds: WidgetInstance["thresholds"]) => {
		const from = { name: session.doc.name, body: session.doc.body };
		const widgets = session.doc.body.widgets.map((w) => ({ ...w, thresholds }));
		session.apply({
			op: "replaceDocument",
			target: {},
			from,
			to: { name: from.name, body: { widgets } }
		});
	};
	setThreshold(undefined);
	// Its re-armed "last told" goes with it.
	await expect.poll(async () => readTold(platform, app.space, docId)).toEqual({});
	nextPoll();
	await expect.element(page.getByText("40.0")).toBeVisible();
	setThreshold([{ level: "unhealthy_sensitive" }]);
	await handled(platform, app, docId, "w1", readingAt(1));
	await expect.poll(() => thresholdMarks.w1?.level.key).toBe("unhealthy_sensitive");
	await new Promise((r) => setTimeout(r, 200));
	expect(toasts()).toHaveLength(0);
});

test("a new place starts afresh: its first reading seeds, a later rise toasts", async () => {
	// Monitor a is Unhealthy (told); b is already at USG at the same hour, then rises.
	const values: Record<string, (number | null)[]> = { a: [60, 60], b: [40, 60] };
	series.values = values.a;
	series.step = 0;
	const { app, platform, docId, session } = await seed([tile("w1")]);
	await handled(platform, app, docId, "w1", readingAt(0));
	expect((await readTold(platform, app.space, docId)).w1.level).toBe("unhealthy");
	series.values = values.b;
	const from = { name: session.doc.name, body: session.doc.body };
	const widgets = session.doc.body.widgets.map((w) => ({
		...w,
		data: {
			layers: [
				{ dataset: "air-quality", entryType: "pm25", place: { kind: "monitor" as const, id: "b" } }
			]
		}
	}));
	session.apply({
		op: "replaceDocument",
		target: {},
		from,
		to: { name: from.name, body: { widgets } }
	});
	// The same hour at b: the mark, "last told" seeded from b, and no toast.
	await expect
		.poll(async () => (await readTold(platform, app.space, docId)).w1?.level, { timeout: 5000 })
		.toBe("unhealthy_sensitive");
	await expect.poll(() => thresholdMarks.w1?.level.key).toBe("unhealthy_sensitive");
	expect(toasts()).toHaveLength(0);
	nextPoll();
	await expect.poll(toastTexts).toEqual([
		m.alert_pollutant_at_place_is_now_level({
			pollutant: "PM2.5",
			place: "Monitor b",
			level: "Unhealthy"
		})
	]);
});

test("a server key reorder of the layers is not a new place: no re-seeding, so a rise toasts", async () => {
	series.values = [40, 60];
	series.step = 0;
	const { app, platform, docId, session } = await seed([tile("w1")]);
	await handled(platform, app, docId, "w1", readingAt(0));
	const from = { name: session.doc.name, body: session.doc.body };
	const widgets = session.doc.body.widgets.map((w) => ({
		...w,
		// The same layer with its keys in another order.
		data: {
			layers: [
				{ place: { id: "a", kind: "monitor" as const }, entryType: "pm25", dataset: "air-quality" }
			]
		}
	}));
	session.apply({
		op: "replaceDocument",
		target: {},
		from,
		to: { name: from.name, body: { widgets } }
	});
	nextPoll();
	await expect.poll(toastTexts, { timeout: 5000 }).toEqual([
		m.alert_pollutant_at_place_is_now_level({
			pollutant: "PM2.5",
			place: "Monitor a",
			level: "Unhealthy"
		})
	]);
});

/** A tile over monitor `pa`, whose alert value the server evaluates. */
const alertTile = () =>
	tile("w1", {
		data: {
			layers: [{ dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id: "pa" } }]
		}
	});
const crossingAtPa = m.alert_pollutant_at_place_is_now_level({
	pollutant: "PM2.5",
	place: "PA",
	level: USG
});

test("with the hourly query failed, the watcher fires on the alert value the tile shows", async () => {
	series.fail = true;
	fake.alertValue = 20;
	const { app, platform, docId } = await seed([alertTile()]);
	await handled(platform, app, docId, "w1");
	expect(toastTexts()).not.toContain(crossingAtPa);
	fake.alertValue = 40;
	fake.now!.refetch("alert:pa");
	await expect.poll(toastTexts, { timeout: 5000 }).toContain(crossingAtPa);
	await expect.element(page.getByText("40.0", { exact: true }).first()).toBeVisible();
});

test("with the hourly query still loading, the watcher fires on the alert value", async () => {
	series.hang = true;
	fake.alertValue = 20;
	const { app, platform, docId } = await seed([alertTile()]);
	await handled(platform, app, docId, "w1");
	fake.alertValue = 40;
	fake.now!.refetch("alert:pa");
	await expect.poll(toastTexts, { timeout: 5000 }).toContain(crossingAtPa);
});

test("when the tile shows an error or loading, the watcher fires nothing", async () => {
	// Hourly fails and the alert has no entry: the tile is an error card.
	series.fail = true;
	fake.alertValue = undefined;
	const { app, platform, docId } = await seed([alertTile()]);
	await expect.poll(() => fake.alertCalls, { timeout: 5000 }).toBeGreaterThan(0);
	await new Promise((r) => setTimeout(r, 300));
	expect(thresholdMarks.w1).toBeUndefined();
	expect(toastTexts().filter((t) => t?.includes(" at PA "))).toEqual([]);
	expect((await readTold(platform, app.space, docId)).w1).toBeUndefined();
});

test("a reading that ages past 3 hours loses its mark between polls", async () => {
	series.values = [40];
	series.step = 0;
	vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"], now: Date.now() });
	try {
		const { app, platform, docId } = await seed([tile("w1", { minimized: { order: 0 } })]);
		await handled(platform, app, docId, "w1", readingAt(0));
		await expect.poll(() => thresholdMarks.w1?.level.key).toBe("unhealthy_sensitive");
		// No poll comes (an outage): only the clock moves. The hour ended 6 minutes before t0, so
		// it is "recent" until t0 + 2 h 54 min.
		vi.advanceTimersByTime(3 * HOUR - 12 * 60_000);
		await new Promise((r) => setTimeout(r, 50));
		expect(thresholdMarks.w1?.level.key).toBe("unhealthy_sensitive");
		vi.advanceTimersByTime(8 * 60_000);
		await expect.poll(() => thresholdMarks.w1).toBeUndefined();
	} finally {
		vi.useRealTimers();
	}
});

test("a place with no current value clears the mark; a failed fetch keeps it", async () => {
	series.values = [40, null];
	series.step = 0;
	const { app, platform, docId } = await seed([tile("w1", { minimized: { order: 0 } })]);
	await handled(platform, app, docId, "w1", readingAt(0));
	await expect.poll(() => thresholdMarks.w1?.level.key).toBe("unhealthy_sensitive");
	series.fail = true;
	for (const e of fake.client!.entries()) fake.client!.refetch(e.key);
	await expect.poll(() => fake.client!.entries()[0]?.failed).toBe(true);
	await new Promise((r) => setTimeout(r, 100));
	expect(thresholdMarks.w1?.level.key).toBe("unhealthy_sensitive");
	series.fail = false;
	nextPoll();
	await expect.poll(() => thresholdMarks.w1).toBeUndefined();
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
	const body = m.alert_pollutant_at_place_is_now_level({
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
