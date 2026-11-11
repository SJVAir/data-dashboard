import { describe, expect, it, vi } from "vitest";
import type { Change } from "$lib/changes/types";
import type { DashboardSummary } from "$lib/documents/names";
import type { ChosenPlace } from "$lib/data/schema";
import { FIXTURE_CATALOG } from "$lib/data/testing/fixtures";
import {
	DashboardSchema,
	StarterDashboardSchema,
	type Dashboard,
	type Rect
} from "$lib/documents/schema";
import { defaultDraft } from "$lib/get-data/draft.svelte";
import { switchRange, toNowDraft } from "$lib/get-data/now";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { SpaceId } from "$lib/platform/types";
import { newPlaceholder } from "$lib/widgets/placeholder";
import { monthCalendarType } from "$lib/widgets/calendars/month";
import { chartType } from "$lib/widgets/chart";
import { currentType } from "$lib/widgets/current";
import { DEFAULT_LAYER, DEFAULT_RANGE } from "$lib/widgets/defaults";
import { forecastType } from "$lib/widgets/forecast";
import { noteType } from "$lib/widgets/notes";
import { outsideType } from "$lib/widgets/outside";
import type { WidgetType } from "$lib/widgets/registry";
import { FORECASTS_ENTRY, PM25_LEVELS } from "$lib/widgets/shared/test-harness/fake-data";
import { report } from "$lib/safety/report";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import {
	STARTER_ID,
	blankDashboard,
	copyOfStarter,
	duplicateDashboard,
	resolveHome,
	starterDashboard,
	starterSession,
	starterTemplate
} from "./starter";
import { resolveDefaultPlace } from "./resolve";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

const SPACE: SpaceId = "anonymous";
const NOW = new Date("2026-10-21T12:00:00.000Z");
const CATALOG = [FIXTURE_CATALOG[0], FORECASTS_ENTRY];

function summary(overrides: Partial<DashboardSummary> & { id: string }): DashboardSummary {
	return {
		name: null,
		createdAt: "2026-10-20T00:00:00Z",
		updatedAt: "2026-10-20T00:00:00Z",
		...overrides
	};
}

const renameWidget = (widgetId: string, to: string): Change => ({
	op: "setField",
	target: { widgetId, path: "title" },
	from: null,
	to
});

const FRESNO = DEFAULT_LAYER.place as ChosenPlace;
const PLACES: ChosenPlace[] = [
	{ kind: "region", type: "city", code: "0614218" },
	{ kind: "monitor", id: "abc123" },
	{ kind: "location", source: "schools", code: "123" },
	{ kind: "point", lat: 36.7378, lon: -119.7871 }
];
const SCHOOL = PLACES[2];
const TYPES: WidgetType[] = [
	noteType,
	currentType,
	outsideType,
	forecastType,
	chartType,
	monthCalendarType
];
const typeOf = (type: string) => TYPES.find((t) => t.type === type)!;

const places = (doc: Dashboard) =>
	doc.body.widgets.flatMap((w) => w.data.layers.map((l) => l.place));
const overlaps = (a: Rect, b: Rect) =>
	a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A document made from the starter: the chosen place everywhere, the bar, valid. */
function expectFromStarter(doc: Dashboard, place: ChosenPlace) {
	expect(DashboardSchema.safeParse(doc).success).toBe(true);
	expect(doc.copiedFrom).toBe(STARTER_ID);
	expect(doc.body.placeBar).toEqual({ place });
	const shown = places(doc).filter((p) => p !== undefined);
	expect(shown.length).toBeGreaterThan(0);
	for (const p of shown) expect(p).toEqual(place);
}

describe("starter template", () => {
	it("holds the six widgets in reading order, each at default-place", () => {
		const template = starterTemplate();
		expect(StarterDashboardSchema.safeParse(template).success).toBe(true);
		expect(DashboardSchema.safeParse(template).success).toBe(false);
		expect(template).toMatchObject({ id: STARTER_ID, name: null, version: 0 });
		expect(template.body.placeBar).toBeUndefined();
		expect(template.body.widgets.map((w) => w.type)).toEqual(TYPES.map((t) => t.type));
		expect(template.body.widgets.every((w) => w.title === null)).toBe(true);
		const note = template.body.widgets[0];
		expect(note.options).toEqual({ message: "starter_note_welcome" });
		expect(note.data).toEqual({ layers: [] });
		const shown = places(template);
		expect(shown).toHaveLength(5);
		for (const p of shown) expect(p).toEqual({ kind: "default-place" });
	});

	it("lays the widgets out in rows, each at least its type's minimum, with no overlaps", () => {
		const [note, current, outside, forecast, chart, calendar] = starterTemplate().body.widgets.map(
			(w) => w.rect
		);
		expect(note).toEqual({ x: 0, y: 0, w: 12, h: 2 });
		// The "now" row: one height that fits "Can we go outside?".
		expect([current.w, outside.w, forecast.w]).toEqual([3, 3, 6]);
		expect(new Set([current.h, outside.h, forecast.h]).size).toBe(1);
		expect(new Set([current.y, outside.y, forecast.y])).toEqual(new Set([note.y + note.h]));
		expect(current.h).toBeGreaterThanOrEqual(outsideType.minSize.h);
		expect([current.x, outside.x, forecast.x]).toEqual([0, 3, 6]);
		// The chart and the month calendar share one height of at least 6.
		expect([chart.w, calendar.w]).toEqual([8, 4]);
		expect([chart.x, calendar.x]).toEqual([0, 8]);
		expect(chart.y).toBe(current.y + current.h);
		expect(calendar.y).toBe(chart.y);
		expect(chart.h).toBe(calendar.h);
		expect(chart.h).toBeGreaterThanOrEqual(6);

		const widgets = starterTemplate().body.widgets;
		for (const w of widgets) {
			const { minSize } = typeOf(w.type);
			expect(w.rect.w).toBeGreaterThanOrEqual(minSize.w);
			expect(w.rect.h).toBeGreaterThanOrEqual(minSize.h);
		}
		for (const [i, a] of widgets.entries())
			for (const b of widgets.slice(i + 1)) expect(overlaps(a.rect, b.rect)).toBe(false);
	});

	it("each widget's data is what Get data stores for its type (PM2.5, Fresno County)", () => {
		const resolved = resolveDefaultPlace(starterTemplate(), FRESNO);
		const [, current, outside, forecast, chart, calendar] = resolved.body.widgets;
		const draft = defaultDraft();
		const now = (type: WidgetType) => toNowDraft(draft, type, CATALOG, PM25_LEVELS).draft.data;
		expect(current.data).toEqual(now(currentType));
		expect(outside.data).toEqual(now(outsideType));
		expect(forecast.data).toEqual(now(forecastType));
		expect(chart.data).toEqual(draft.data);
		expect(chart.data.dateRange).toEqual(DEFAULT_RANGE);
		const moved = switchRange(draft.data, chartType, monthCalendarType, NOW);
		expect(calendar.data).toEqual({ layers: draft.data.layers, dateRange: moved.dateRange });
		expect(calendar.data.dateRange).toEqual({ kind: "to-date", unit: "month" });
		for (const w of [current, outside, chart, calendar])
			expect(w.data.layers[0].entryType).toBe("pm25");
	});

	it("returns a fresh object each time", () => {
		const a = starterTemplate();
		a.body.widgets.pop();
		expect(starterTemplate().body.widgets).toHaveLength(6);
	});

	it("a new placeholder is three columns wide", () => {
		expect(newPlaceholder([]).rect.w).toBe(3);
	});
});

describe("starter dashboard", () => {
	it("is the template at the chosen place, with the bar, for every kind of place", () => {
		for (const place of [FRESNO, ...PLACES]) {
			const starter = starterDashboard(place);
			expect(DashboardSchema.safeParse(starter).success).toBe(true);
			expect(starter.id).toBe(STARTER_ID);
			expect(starter.body.placeBar).toEqual({ place });
			expect(places(starter).filter((p) => p !== undefined)).toEqual(Array(5).fill(place));
			expect(JSON.stringify(starter)).not.toContain("default-place");
		}
	});

	it("starter with a gone place still builds", () => {
		// A removed monitor, a closed school: the starter doesn't look them up.
		for (const place of [
			{ kind: "monitor", id: "removed-monitor" },
			{ kind: "location", source: "schools", code: "closed-1999" }
		] as const) {
			const starter = starterDashboard(place);
			expect(DashboardSchema.safeParse(starter).success).toBe(true);
			expect(starter.body.placeBar).toEqual({ place });
		}
	});

	it("rejects default-place in the bar", () => {
		const starter = starterDashboard(FRESNO);
		starter.body.placeBar = { place: { kind: "default-place" } as unknown as ChosenPlace };
		expect(DashboardSchema.safeParse(starter).success).toBe(false);
		expect(StarterDashboardSchema.safeParse(starter).success).toBe(false);
	});

	it("copies, blanks, and duplicates are schema-valid new documents", () => {
		const copy = copyOfStarter(NOW, SCHOOL);
		expect(copy.id).not.toBe(STARTER_ID);
		expect(copy).toMatchObject({
			copiedFrom: STARTER_ID,
			name: null,
			version: 0,
			createdAt: NOW.toISOString(),
			updatedAt: NOW.toISOString()
		});
		expect(copy.body.widgets).toHaveLength(6);
		expectFromStarter(copy, SCHOOL);

		const blank = blankDashboard(NOW);
		expect(blank.body).toEqual({ widgets: [] });
		expect(blank.copiedFrom).toBeUndefined();

		const source: Dashboard = { ...copy, name: "School", version: 7 };
		const dup = duplicateDashboard(source, NOW);
		expect(dup.id).not.toBe(source.id);
		expect(dup).toMatchObject({ name: "School", copiedFrom: source.id, version: 0 });
		expect(dup.deletedAt).toBeUndefined();

		for (const doc of [copy, blank, dup]) expect(DashboardSchema.safeParse(doc).success).toBe(true);
	});
});

describe("resolveHome", () => {
	it("no dashboards → starter", () => {
		expect(resolveHome([], undefined)).toEqual({ kind: "starter" });
		expect(resolveHome([], "gone")).toEqual({ kind: "starter" });
	});

	it("last-opened wins", () => {
		const summaries = [
			summary({ id: "a", updatedAt: "2026-10-20T01:00:00Z" }),
			summary({ id: "b", updatedAt: "2026-10-20T05:00:00Z" })
		];
		expect(resolveHome(summaries, "a")).toEqual({ kind: "dashboard", id: "a" });
	});

	it("deleted last-opened falls back to most recently updated", () => {
		const summaries = [
			summary({ id: "a", updatedAt: "2026-10-20T09:00:00Z", deletedAt: "2026-10-20T09:00:00Z" }),
			summary({ id: "b", updatedAt: "2026-10-20T05:00:00Z" }),
			summary({ id: "c", updatedAt: "2026-10-20T01:00:00Z" })
		];
		expect(resolveHome(summaries, "a")).toEqual({ kind: "dashboard", id: "b" });
	});

	it("missing last-opened falls back", () => {
		const summaries = [
			summary({ id: "a", updatedAt: "2026-10-20T01:00:00Z" }),
			summary({ id: "b", updatedAt: "2026-10-20T05:00:00Z" })
		];
		expect(resolveHome(summaries, "gone")).toEqual({ kind: "dashboard", id: "b" });
		expect(resolveHome(summaries, undefined)).toEqual({ kind: "dashboard", id: "b" });
	});

	it("all deleted → starter", () => {
		const summaries = [
			summary({ id: "a", deletedAt: "2026-10-20T09:00:00Z" }),
			summary({ id: "b", deletedAt: "2026-10-20T09:00:00Z" })
		];
		expect(resolveHome(summaries, "a")).toEqual({ kind: "starter" });
	});
});

describe("starterSession", () => {
	async function setup() {
		const platform = createMemoryPlatform();
		const copies: string[] = [];
		const starter = starterSession({
			platform,
			space: SPACE,
			tabId: "tab-1",
			now: () => NOW,
			place: SCHOOL,
			onCopied: (session) => copies.push(session.doc.id)
		});
		starter.apply(renameWidget("starter-1", "Fresno"));
		await vi.waitFor(() => expect(copies).toHaveLength(1));
		return { platform, starter, copies };
	}

	it("first edit of the starter creates a stored copy with copiedFrom starter and the edit applied", async () => {
		const { platform, copies } = await setup();
		await vi.waitFor(async () => {
			const stored = (await platform.documents.get(SPACE, copies[0])) as Dashboard;
			expect(stored.copiedFrom).toBe(STARTER_ID);
			expect(stored.name).toBeNull();
			expect(stored.body.widgets[0].title).toBe("Fresno");
			expectFromStarter(stored, SCHOOL);
		});
		expect(await platform.documents.list(SPACE)).toHaveLength(1);
	});

	it("a first edit after this browser's data was cleared stores no copy", async () => {
		const platform = createMemoryPlatform();
		const onCleared = vi.fn();
		const onCopied = vi.fn();
		const starter = starterSession({
			platform,
			space: SPACE,
			tabId: "tab-1",
			now: () => NOW,
			place: SCHOOL,
			onCleared,
			onCopied
		});
		// Another tab cleared the data; this one missed the broadcast.
		await platform.reset.clearAll();
		starter.apply(renameWidget("starter-1", "Fresno"));
		await vi.waitFor(() => expect(onCleared).toHaveBeenCalled());
		expect(onCopied).not.toHaveBeenCalled();
		expect(await platform.documents.list(SPACE)).toEqual([]);
	});

	it("the hand-off validates the copy before storing it", async () => {
		const platform = createMemoryPlatform();
		const commit = vi.spyOn(platform.documents, "commit");
		const onCopied = vi.fn();
		const starter = starterSession({
			platform,
			space: SPACE,
			tabId: "tab-1",
			now: () => NOW,
			// A place that slipped past the types: the copy would hold default-place.
			place: { kind: "default-place" } as unknown as ChosenPlace,
			onCopied
		});
		starter.apply(renameWidget("starter-1", "Fresno"));
		await vi.waitFor(() => expect(starter.status).toBe("error"));
		expect(report).toHaveBeenCalledWith(expect.any(Error), { operation: "hand-off" });
		expect(commit).not.toHaveBeenCalled();
		expect(onCopied).not.toHaveBeenCalled();
		expect(await platform.documents.list(SPACE)).toEqual([]);
	});

	it("the starter stays unchanged", async () => {
		const { platform, starter } = await setup();
		expect(starter.doc).toEqual(starterDashboard(SCHOOL));
		expect(await platform.documents.get(SPACE, STARTER_ID)).toBeUndefined();
	});

	it("later edits go to the copy", async () => {
		const { platform, starter, copies } = await setup();
		starter.apply(renameWidget("starter-2", "Visalia"));
		await vi.waitFor(async () => {
			const stored = (await platform.documents.get(SPACE, copies[0])) as Dashboard;
			expect(stored.body.widgets[1].title).toBe("Visalia");
		});
		expect(copies).toHaveLength(1);
	});

	it("edits made on the starter during the hand-off apply before edits made on the copy", async () => {
		const platform = createMemoryPlatform();
		// The copy's creation is stored at once; its later saves wait until released.
		const commit = platform.documents.commit;
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		platform.documents.commit = async (space, request) => {
			if (request.baseVersion !== null) await held;
			return commit(space, request);
		};
		const copied: { session?: DocumentSession } = {};
		const starter = starterSession({
			platform,
			space: SPACE,
			tabId: "tab-1",
			now: () => NOW,
			place: SCHOOL,
			onCopied: (session) => (copied.session = session)
		});
		starter.apply(renameWidget("starter-1", "Fresno"));
		// Made while the copy is being stored, so it waits for the hand-off.
		starter.apply(renameWidget("starter-2", "Visalia"));
		await vi.waitFor(() => expect(copied.session).toBeDefined());
		// The copy is current now, so the next edit goes to it directly.
		const copy = copied.session!;
		copy.apply(renameWidget("starter-2", "Merced"));
		release();
		await vi.waitFor(async () => {
			const stored = (await platform.documents.get(SPACE, copy.doc.id)) as Dashboard;
			expect(stored.version).toBeGreaterThanOrEqual(3);
		});
		await copy.flush();
		expect(copy.doc.body.widgets[1].title).toBe("Merced");
		const stored = (await platform.documents.get(SPACE, copy.doc.id)) as Dashboard;
		expect(stored.body.widgets[1].title).toBe("Merced");
	});

	it("undo after the copy reverts the edit but the copy remains", async () => {
		const platform = createMemoryPlatform();
		const copied: { session?: DocumentSession } = {};
		const starter = starterSession({
			platform,
			space: SPACE,
			tabId: "tab-1",
			now: () => NOW,
			place: SCHOOL,
			onCopied: (session) => (copied.session = session)
		});
		starter.apply(renameWidget("starter-1", "Fresno"));
		await vi.waitFor(() => expect(copied.session).toBeDefined());
		const session = copied.session!;
		expect(session.canUndo).toBe(true);
		session.undo();
		await session.flush();
		const stored = (await platform.documents.get(SPACE, session.doc.id)) as Dashboard;
		expect(stored.body.widgets[0].title).toBeNull();
		expect(stored.copiedFrom).toBe(STARTER_ID);
	});

	/** A starter whose hand-off hook fails (`null` or rejecting) on its first attempt. */
	function failingFirst(failure: "null" | "reject") {
		const platform = createMemoryPlatform();
		const commit = platform.documents.commit;
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		let creations = 0;
		platform.documents.commit = async (space, request) => {
			if (request.baseVersion === null && creations++ === 0) {
				await held;
				if (failure === "reject") throw new Error("disk");
				return { ok: false, currentVersion: 0 };
			}
			return commit(space, request);
		};
		const copied: { session?: DocumentSession } = {};
		const starter = starterSession({
			platform,
			space: SPACE,
			tabId: "tab-1",
			now: () => NOW,
			place: SCHOOL,
			onCopied: (session) => (copied.session = session)
		});
		return { platform, starter, copied, release };
	}

	for (const failure of ["null", "reject"] as const) {
		it(`edits made during the starter hand-off survive a ${failure} hand-off`, async () => {
			const { platform, starter, copied, release } = failingFirst(failure);
			starter.apply(renameWidget("starter-1", "Fresno"));
			starter.apply(renameWidget("starter-2", "Visalia"));
			release();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(copied.session).toBeUndefined();
			if (failure === "reject") {
				expect(starter.status).toBe("error");
				expect(starter.errorKind).toBe("unavailable");
				expect(report).toHaveBeenCalledWith(expect.any(Error), { operation: "hand-off" });
			}

			starter.apply(renameWidget("starter-3", "Merced"));
			await vi.waitFor(() => expect(copied.session).toBeDefined());
			const copy = copied.session!;
			await copy.flush();
			const stored = (await platform.documents.get(SPACE, copy.doc.id)) as Dashboard;
			expect(stored.body.widgets.slice(0, 3).map((w) => w.title)).toEqual([
				"Fresno",
				"Visalia",
				"Merced"
			]);
			const log = (await platform.documents.readLog(SPACE, copy.doc.id, 0)) as { change: Change }[];
			expect(log.map((e) => e.change)).toEqual([
				renameWidget("starter-1", "Fresno"),
				renameWidget("starter-2", "Visalia"),
				renameWidget("starter-3", "Merced")
			]);
			expect(platform.journal.readAll(SPACE, STARTER_ID)).toEqual([]);
		});
	}

	it("pagehide during the starter hand-off journals the queued edits", async () => {
		const win = new EventTarget();
		vi.stubGlobal("window", win);
		try {
			const platform = createMemoryPlatform();
			// The copy is never stored: the page goes away mid-hand-off.
			const commit = platform.documents.commit;
			platform.documents.commit = () => new Promise(() => {});
			const starter = starterSession({
				platform,
				space: SPACE,
				tabId: "gone",
				now: () => NOW,
				place: SCHOOL
			});
			starter.apply(renameWidget("starter-1", "Fresno"));
			starter.apply(renameWidget("starter-2", "Visalia"));
			win.dispatchEvent(new Event("pagehide"));
			expect(platform.journal.readAll(SPACE, STARTER_ID)).toEqual([
				{
					tabId: "gone",
					record: {
						baseVersion: 0,
						changes: [renameWidget("starter-1", "Fresno"), renameWidget("starter-2", "Visalia")],
						schemaVersion: 1,
						writtenAt: NOW.toISOString()
					}
				}
			]);

			// The next page load's starter replays them through its own hand-off.
			platform.documents.commit = commit;
			const copied: { session?: DocumentSession } = {};
			const next = starterSession({
				platform,
				space: SPACE,
				tabId: "tab-2",
				now: () => NOW,
				place: SCHOOL,
				onCopied: (session) => (copied.session = session)
			});
			await next.replayPending();
			expect(copied.session).toBeDefined();
			const copy = copied.session!;
			await copy.flush();
			const stored = (await platform.documents.get(SPACE, copy.doc.id)) as Dashboard;
			expect(stored.copiedFrom).toBe(STARTER_ID);
			expect(stored.body.widgets.slice(0, 3).map((w) => w.title)).toEqual([
				"Fresno",
				"Visalia",
				null
			]);
			expect(platform.journal.readAll(SPACE, STARTER_ID)).toEqual([]);
			// Replaying again finds nothing.
			await next.replayPending();
			expect(await platform.documents.list(SPACE)).toHaveLength(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
