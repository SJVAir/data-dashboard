import "../app.css";
import { afterEach, expect, test, vi } from "vitest";
import { toast } from "svelte-sonner";
import { blockNavigation } from "sv-router";
import { render } from "vitest-browser-svelte";
import { commands, page, userEvent } from "vitest/browser";
import TopNav from "$lib/components/shell/TopNav.svelte";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { FIXTURE_CATALOG } from "$lib/data/testing/fixtures";
import { DRAFT_KEY, type Draft } from "$lib/get-data/draft.svelte";
import { setSmokeAndFire } from "$lib/get-data/map";
import { setPlatform } from "$lib/platform";
import { m } from "$lib/paraglide/messages.js";
import { chartType } from "$lib/widgets/chart";
import { showInDraft } from "$lib/widgets/map/show-in";
import { ADDED_HIGHLIGHT_MS } from "$lib/layout/focus-request.svelte";
import { createMemoryPlatform } from "$lib/platform/memory";
import { blankDashboard, STARTER_ID, starterTemplate } from "$lib/starter/starter";
import { getMetadata } from "$lib/data";
import { APP_CONTEXT_KEY, LAST_OPENED_KEY, initApp, type AppContext } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { animationsSettled } from "../test/animations";
import { openSection } from "../test/sections";
import App from "../App.svelte";
import { navigate } from "../router";
import GetData from "./GetData.svelte";

declare module "vitest/browser" {
	interface BrowserCommands {
		setReducedMotion: (reduce: boolean | null) => Promise<void>;
	}
}

const reported = vi.hoisted(() => [] as Array<{ operation?: string }>);
vi.mock("$lib/safety/report", () => ({
	report: (_error: unknown, context?: { operation?: string }) => reported.push(context ?? {})
}));

// The view below the heading runs queries; a client with no adapters keeps them local.
vi.mock("$lib/data", async () => {
	const { createQueryClient } = await import("$lib/data/query/client");
	const { fixtureMetadata } = await import("$lib/data/testing/fixtures");
	// Monitors r1–r7, for a hand-off from a Map.
	const metadata = fixtureMetadata({
		monitors: async () =>
			["r1", "r2", "r3", "r4", "r5", "r6", "r7"].map((id) => ({
				id,
				name: `Monitor ${id}`,
				type: "purpleair",
				county: "Fresno",
				active: true,
				inside: false
			}))
	});
	const regions = { resolve: async () => null };
	const client = createQueryClient({ adapters: [], metadata, regions });
	return {
		adapterOffers: () => [],
		getQueryClient: () => client,
		getMetadata: () => metadata,
		getResolvers: () => ({
			regions,
			locations: { resolve: async () => null },
			points: { keys: async () => [] }
		}),
		placeRegion: async () => null
	};
});

const originalUrl = location.href;
afterEach(() => {
	history.replaceState(null, "", originalUrl);
	// A toast left up would cover the next test's buttons.
	toast.dismiss();
});

async function setup() {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	return new Map([[APP_CONTEXT_KEY, app]]);
}

test("at /data the heading takes focus and the Data nav link is current", async () => {
	const context = await setup();
	await navigate("/data");
	await render(TopNav, { context });
	await render(GetData, { context });
	const heading = page.getByRole("heading", { name: "Data Portal" });
	await expect.element(heading).toHaveFocus();
	await expect
		.element(page.getByRole("link", { name: "Data Portal" }))
		.toHaveAttribute("aria-current", "page");
});

test("the edit route says Data Portal, focused, and that it's changing a widget", async () => {
	await editAt({ id: "d1", widgetId: "w1" });
	await expect.element(page.getByRole("heading", { name: "Data Portal" })).toHaveFocus();
	await expect.element(page.getByText("Changing a widget's data")).toBeVisible();
});

// Add to dashboard ----------------------------------------------------------------------------

/** Where a test opens the app (the router's own navigation, so it shows no route from before). */
const fromDashboard = () =>
	navigate("/dashboards/:id/widgets/new", { params: { id: "d1" }, search: { type: "chart" } });
const fromNav = () => navigate("/data");

/**
 * The whole app over dashboards named `names` (stored oldest first: d1, d2, …), opened by `go`,
 * with `lastOpened` as the last-opened dashboard.
 */
async function appAt(go: () => Promise<unknown>, names: string[] = [], lastOpened?: string) {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	for (const [i, name] of names.entries()) {
		const doc: Dashboard = {
			...blankDashboard(new Date(Date.UTC(2026, 10, 1 + i))),
			id: `d${i + 1}`,
			name
		};
		await platform.documents.commit(app.space, {
			docId: doc.id,
			baseVersion: null,
			doc,
			entries: []
		});
	}
	if (lastOpened) await platform.preferences.set(app.space, LAST_OPENED_KEY, lastOpened);
	await app.index.refresh();
	await go();
	await render(App, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	return app;
}

const addButton = (name: string) => page.getByRole("button", { name: `Add to ${name}` });

/** The one widget added to `app`'s current dashboard, once that dashboard shows it. */
async function landed(app: AppContext, id: string) {
	await expect.poll(() => location.pathname).toBe(`/workspace/dashboards/${id}`);
	await expect.poll(() => app.current.session?.doc.body.widgets.length).toBe(1);
	const widget = app.current.session!.doc.body.widgets[0];
	const frame = page.getByTestId(`widget-${widget.id}`);
	await expect.element(frame).toBeVisible();
	return { widget, frame: frame.element() as HTMLElement };
}

const focusedIn = (frame: HTMLElement) => frame.contains(document.activeElement);

test("Add to the dashboard you came from: lands there with the widget focused and highlighted; one Undo removes it", async () => {
	const app = await appAt(fromDashboard, ["Home", "School"]);
	await addButton("Home").click();
	const { frame } = await landed(app, "d1");
	await expect.poll(() => focusedIn(frame)).toBe(true);
	// No copy was made, so nothing says so.
	expect(page.getByText("Saved as your own dashboard").query()).toBeNull();
	expect(frame.hasAttribute("data-added")).toBe(true);
	expect(getComputedStyle(frame).animationName).toBe("widget-added");
	// The highlight goes after 2 s.
	await expect
		.poll(() => frame.hasAttribute("data-added"), { timeout: ADDED_HIGHLIGHT_MS + 2000 })
		.toBe(false);
	await userEvent.keyboard("{Control>}z{/Control}");
	expect(app.current.session!.doc.body.widgets).toEqual([]);
	expect(app.current.session!.canUndo).toBe(false);
});

test("from /data the target is the last-opened dashboard; the menu lists the others and New dashboard", async () => {
	const app = await appAt(fromNav, ["Home", "School"], "d2");
	await expect.element(addButton("School")).toBeVisible();
	await page.getByRole("button", { name: "Add to another dashboard" }).click();
	const items = page.getByRole("menuitem");
	await expect.element(items.first()).toBeVisible();
	expect(items.elements().map((e) => e.textContent?.trim())).toEqual(["Home", "New dashboard"]);
	await page.getByRole("menuitem", { name: "New dashboard" }).click();
	await expect.poll(() => app.index.items.length).toBe(3);
	const created = app.index.items.find((d) => d.id !== "d1" && d.id !== "d2")!;
	await landed(app, created.id);
});

test("with no dashboards, Add to Starter dashboard makes the copy and lands on it", async () => {
	const app = await appAt(fromNav);
	await addButton("Starter dashboard").click();
	await expect.poll(() => location.pathname).not.toBe("/workspace/data");
	const copy = app.current.session!;
	expect(copy.doc.id).not.toBe(STARTER_ID);
	expect(copy.doc.copiedFrom).toBe(STARTER_ID);
	await expect.poll(() => location.pathname).toBe(`/workspace/dashboards/${copy.doc.id}`);
	// As any first edit of the starter says.
	await expect.element(page.getByText("Saved as your own dashboard")).toBeVisible();
	const added = copy.doc.body.widgets.at(-1)!;
	expect(added.type).toBe("chart");
	const frame = page.getByTestId(`widget-${added.id}`);
	await expect.poll(() => focusedIn(frame.element() as HTMLElement)).toBe(true);
	// Undo takes the widget off and keeps the copy.
	await userEvent.keyboard("{Control>}z{/Control}");
	expect(app.current.session!.doc.body.widgets.map((w) => w.id)).not.toContain(added.id);
	expect(app.current.session!.doc.id).toBe(copy.doc.id);
});

test("with reduced motion the added widget is focused, not animated", async () => {
	await commands.setReducedMotion(true);
	try {
		const app = await appAt(fromDashboard, ["Home"]);
		await addButton("Home").click();
		const { frame } = await landed(app, "d1");
		await expect.poll(() => focusedIn(frame)).toBe(true);
		expect(getComputedStyle(frame).animationName).toBe("none");
	} finally {
		await commands.setReducedMotion(null);
	}
});

test("Add widget on an unknown dashboard shows the not-found page", async () => {
	await appAt(
		() => navigate("/dashboards/:id/widgets/new", { params: { id: "d9" } }),
		["Home"],
		"d1"
	);
	await expect
		.element(page.getByRole("heading", { name: "This dashboard isn't saved in this browser." }))
		.toBeVisible();
	expect(addButton("Home").query()).toBeNull();
});

test("a second click while the dashboard opens adds one widget", async () => {
	const app = await appAt(fromDashboard, ["Home"]);
	// Hold the navigation to the dashboard, so the page stays up after the add.
	let release!: (go: boolean) => void;
	const unblock = blockNavigation(() => new Promise<boolean>((resolve) => (release = resolve)));
	try {
		await addButton("Home").click();
		const session = (await app.sessions.get("d1"))!;
		await expect.poll(() => session.doc.body.widgets.length).toBe(1);
		await expect.element(addButton("Home")).toBeDisabled();
		(addButton("Home").element() as HTMLButtonElement).click();
		release(true);
		await landed(app, "d1");
		expect(session.doc.body.widgets).toHaveLength(1);
	} finally {
		unblock();
	}
});

// Edit data ------------------------------------------------------------------------------------

const FRESNO = { kind: "region", type: "county", code: "06019" } as const;

/** A Chart saved before Get data existed: one layer, no date range, no options. */
const preSpec: WidgetInstance = {
	id: "w1",
	type: "chart",
	title: null,
	rect: { x: 0, y: 0, w: 4, h: 6 },
	data: { place: FRESNO, layers: [{ dataset: "air-quality", entryType: "pm25" }] }
};

/** The whole app with dashboard d1 holding `widgets`, opened on d1 and then Edit data (`params`). */
async function editAt(params: { id: string; widgetId: string } | null, widgets = [preSpec]) {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const doc: Dashboard = { ...blankDashboard(new Date()), id: "d1", name: "Home" };
	doc.body = { widgets };
	await platform.documents.commit(app.space, { docId: "d1", baseVersion: null, doc, entries: [] });
	await app.index.refresh();
	await navigate("/dashboards/:id", { params: { id: "d1" } });
	await render(App, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	if (params) await navigate("/dashboards/:id/widgets/:widgetId/edit", { params });
	return { app, platform };
}

const editPath = "/workspace/dashboards/d1/widgets/w1/edit";
const saveButton = () => page.getByRole("button", { name: "Save changes" });
const discardDialog = () => page.getByRole("alertdialog", { name: "Discard changes?" });

test("⋯ Edit data opens the widget's data", async () => {
	await editAt(null, [{ ...preSpec, type: "data-table" }]);
	await page.getByRole("button", { name: /^Actions for / }).click();
	await page.getByRole("menuitem", { name: "Open in Data Portal" }).click();
	await expect.poll(() => location.pathname).toBe(editPath);
	await expect.element(page.getByRole("heading", { name: "Data Portal" })).toBeVisible();
	await expect.element(page.getByRole("radio", { name: "Data table" })).toBeChecked();
	await expect.element(saveButton()).toBeVisible();
});

test("an unknown dashboard or widget id shows the not-found page", async () => {
	await editAt({ id: "d9", widgetId: "w1" });
	await expect
		.element(page.getByRole("heading", { name: "This dashboard isn't saved in this browser." }))
		.toBeVisible();
	await expect.element(page.getByRole("link", { name: "Your dashboards" })).toBeVisible();
	expect(saveButton().query()).toBeNull();
	await navigate("/dashboards/:id/widgets/:widgetId/edit", {
		params: { id: "d1", widgetId: "nope" }
	});
	await expect
		.element(page.getByRole("heading", { name: "This widget's data can't be edited here." }))
		.toBeVisible();
	expect(saveButton().query()).toBeNull();
});

test("Edit data whose dashboard fails to open says it isn't here, and reports the failure", async () => {
	const { app } = await editAt(null);
	reported.length = 0;
	vi.spyOn(app.sessions, "get").mockRejectedValueOnce(new Error("storage"));
	await navigate("/dashboards/:id/widgets/:widgetId/edit", {
		params: { id: "d1", widgetId: "w1" }
	});
	await expect
		.element(page.getByRole("heading", { name: "This dashboard isn't saved in this browser." }))
		.toBeVisible();
	expect(reported).toEqual([{ operation: "get-data-open" }]);
});

test("a pre-spec widget opens unchanged; Save changes with no changes applies nothing", async () => {
	const { app, platform } = await editAt({ id: "d1", widgetId: "w1" });
	await expect.element(page.getByRole("heading", { name: "Data Portal" })).toBeVisible();
	await expect.element(page.getByRole("radio", { name: "Chart" })).toBeChecked();
	await saveButton().click();
	const { widget, frame } = await landed(app, "d1");
	expect(widget).toEqual(preSpec);
	expect(app.current.session!.canUndo).toBe(false);
	await expect.poll(() => focusedIn(frame)).toBe(true);
	// Editing never writes the Get data draft.
	expect(await platform.preferences.get(app.space, DRAFT_KEY)).toBeUndefined();
});

/**
 * The whole app on Edit data for the starter's widget of `type`, the catalog held until `answer()`
 * (then giving `types` as the air-quality monitor types).
 */
async function starterEditAt(type: string, types: string[]) {
	const platform = createMemoryPlatform();
	// The previews (and the dashboard Save lands on) read the platform adapter.
	setPlatform(platform);
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	let answer!: () => void;
	const held = new Promise<void>((resolve) => (answer = resolve));
	const catalog = vi.spyOn(getMetadata(), "catalog").mockImplementation(async () => {
		await held;
		return FIXTURE_CATALOG.map((d) => (d.id === "air-quality" ? { ...d, monitorTypes: types } : d));
	});
	const index = starterTemplate().body.widgets.findIndex((w) => w.type === type);
	const widgetId = `starter-${index + 1}`;
	await navigate("/dashboards/:id/widgets/:widgetId/edit", {
		params: { id: STARTER_ID, widgetId }
	});
	await render(App, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect.element(saveButton()).toBeVisible();
	/** The stored copy's widget, once Save made the copy. */
	const savedWidget = async () => {
		await expect.poll(() => app.current.session?.doc.copiedFrom).toBe(STARTER_ID);
		const copy = app.current.session!;
		await copy.flush();
		const stored = (await platform.documents.get(app.space, copy.doc.id)) as Dashboard;
		return stored.body.widgets.find((w) => w.id === widgetId)!;
	};
	return { app, platform, answer, restore: () => catalog.mockRestore(), savedWidget };
}

// Edit data opens the starter untracked, so the types' arrival doesn't reopen it: Get data's claim
// keeps the starter it opened usable (without it, the types swap discards it).
test("Edit data on the starter while the types load: the copy it saves keeps saving", async () => {
	const { app, platform, answer, restore } = await starterEditAt("chart", ["purpleair"]);
	try {
		// The types arrive while Edit data holds the starter (nothing is current here).
		answer();
		await expect.poll(() => app.starterTypes).not.toBeNull();
		await page.getByRole("radio", { name: "Data table" }).click();
		await saveButton().click();
		await expect.poll(() => app.current.session?.doc.copiedFrom).toBe(STARTER_ID);
		const copy = app.current.session!;
		await copy.flush();
		// A later edit on the copy is stored.
		copy.apply({ op: "setField", target: { path: "name" }, from: null, to: "Mine" });
		await copy.flush();
		const stored = (await platform.documents.get(app.space, copy.doc.id)) as Dashboard;
		expect(stored.name).toBe("Mine");
	} finally {
		restore();
	}
});

const datesButton = () => page.getByRole("button", { name: /^Dates/ });

/** The air-quality What section (this test has no catalog, so it carries its dataset key). */
const AIR_QUALITY = /^air.quality(?! forecasts)/i;

/** A draft change the Map offers while the catalog loads: its dates. */
async function chooseLastWeek() {
	await datesButton().click();
	await page.getByRole("option", { name: "Last 7 days" }).click();
	await animationsSettled(document.body);
	await expect.element(datesButton()).toHaveTextContent("Last 7 days");
}

/** The stored Map's dates are the ones chosen (the starter's are Now). */
const lastWeek = (map: WidgetInstance) =>
	expect(map.data.dateRange).toEqual({ kind: "trailing", amount: 7, unit: "day" });

test("Edit data on the starter's Map: a change made while the types load survives their arrival, and Save stores them", async () => {
	const { app, answer, restore, savedWidget } = await starterEditAt("map", [
		"purpleair",
		"bam1022"
	]);
	try {
		await chooseLastWeek();
		answer();
		await expect.poll(() => app.starterTypes).not.toBeNull();
		await openSection(AIR_QUALITY);
		// The types swap left the draft alone.
		await expect.element(page.getByRole("checkbox", { name: "BAM 1022" })).toBeVisible();
		await expect.element(datesButton()).toHaveTextContent("Last 7 days");
		await saveButton().click();
		const map = await savedWidget();
		const air = map.data.layers.find((l) => l.dataset === "air-quality");
		expect(air?.monitorTypes).toEqual(["purpleair", "bam1022"]);
		lastWeek(map);
	} finally {
		restore();
	}
});

test("Edit data on the starter's Map saved before the types arrive waits for them", async () => {
	const { answer, restore, savedWidget } = await starterEditAt("map", ["purpleair"]);
	try {
		await chooseLastWeek();
		await saveButton().click();
		answer();
		const map = await savedWidget();
		const air = map.data.layers.find((l) => l.dataset === "air-quality");
		expect(air?.monitorTypes).toEqual(["purpleair"]);
	} finally {
		restore();
	}
});

test("Edit data on the starter's Map saved, then left before the types arrive: saved, and the page stays where it went", async () => {
	const { app, platform, answer, restore } = await starterEditAt("map", ["purpleair"]);
	try {
		await chooseLastWeek();
		await saveButton().click();
		// Saved (shown on the starter at once); the copy waits for the types. Leaving doesn't ask.
		await page.getByRole("link", { name: "Dashboards" }).click();
		await expect.poll(() => location.pathname).toBe("/workspace/dashboards");
		expect(discardDialog().query()).toBeNull();
		answer();
		await expect.poll(async () => (await platform.documents.list(app.space)).length).toBe(1);
		const copy = (await app.sessions.get(app.index.items[0]?.id ?? ""))!;
		await copy.flush();
		const map = copy.doc.body.widgets.find((w) => w.type === "map")!;
		expect(map.data.layers.find((l) => l.dataset === "air-quality")?.monitorTypes).toEqual([
			"purpleair"
		]);
		lastWeek(map);
		// Nothing pulled the person to the copy's dashboard, or made it current on the list.
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(location.pathname).toBe("/workspace/dashboards");
		expect(app.current.session).toBeNull();
	} finally {
		restore();
	}
});

test("Edit data on the starter's Map saved, then the Data Portal link before the types arrive: no ask, and Get data stays", async () => {
	const { app, platform, answer, restore } = await starterEditAt("map", ["purpleair"]);
	try {
		await chooseLastWeek();
		await saveButton().click();
		await page.getByRole("link", { name: "Data Portal" }).click();
		await expect.poll(() => location.pathname).toBe("/workspace/data");
		expect(discardDialog().query()).toBeNull();
		answer();
		await expect.poll(async () => (await platform.documents.list(app.space)).length).toBe(1);
		await app.index.refresh();
		const copy = (await app.sessions.get(app.index.items[0]?.id ?? ""))!;
		await copy.flush();
		lastWeek(copy.doc.body.widgets.find((w) => w.type === "map")!);
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(location.pathname).toBe("/workspace/data");
		expect(app.current.session).toBeNull();
	} finally {
		restore();
	}
});

test("Edit data on the starter's Map saved, changed again, then the Data Portal link and Discard: Get data stays when the copy lands", async () => {
	const { app, platform, answer, restore } = await starterEditAt("map", ["purpleair"]);
	try {
		await chooseLastWeek();
		await saveButton().click();
		// A change after Save: leaving asks about that one.
		await datesButton().click();
		await page.getByRole("option", { name: "Last 30 days" }).click();
		await animationsSettled(document.body);
		await page.getByRole("link", { name: "Data Portal" }).click();
		await expect.element(discardDialog()).toBeVisible();
		await page.getByRole("button", { name: "Discard" }).click();
		await expect.poll(() => location.pathname).toBe("/workspace/data");
		answer();
		await expect.poll(async () => (await platform.documents.list(app.space)).length).toBe(1);
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(location.pathname).toBe("/workspace/data");
		expect(app.current.session).toBeNull();
		// Get data still works: its own Save state wasn't left busy.
		await expect.element(page.getByRole("heading", { name: "Data Portal" })).toBeVisible();
	} finally {
		restore();
	}
});

test("Edit data on the starter's Map with no types in the catalog ticks none", async () => {
	const { answer, restore, savedWidget } = await starterEditAt("map", []);
	try {
		await chooseLastWeek();
		answer();
		await saveButton().click();
		const map = await savedWidget();
		const air = map.data.layers.find((l) => l.dataset === "air-quality");
		expect(air).not.toHaveProperty("monitorTypes");
	} finally {
		restore();
	}
});

test("Edit data on the starter's Map keeps exactly the types the person ticked", async () => {
	const { app, answer, restore, savedWidget } = await starterEditAt("map", [
		"purpleair",
		"bam1022"
	]);
	try {
		answer();
		await expect.poll(() => app.starterTypes).not.toBeNull();
		await openSection(AIR_QUALITY);
		await page.getByRole("checkbox", { name: "BAM 1022" }).click();
		await saveButton().click();
		const map = await savedWidget();
		const air = map.data.layers.find((l) => l.dataset === "air-quality");
		expect(air?.monitorTypes).toEqual(["bam1022"]);
	} finally {
		restore();
	}
});

test("Save changes on the starter's unchanged Map makes no copy", async () => {
	const { app, platform, answer, restore } = await starterEditAt("map", ["purpleair"]);
	try {
		answer();
		await expect.poll(() => app.starterTypes).not.toBeNull();
		await saveButton().click();
		await expect.poll(() => location.pathname).toBe("/workspace/");
		expect(app.current.isStarter).toBe(true);
		expect((await platform.documents.list(app.space)).length).toBe(0);
	} finally {
		restore();
	}
});

test("Save changes applies one undo step and focuses the widget's title", async () => {
	const { app } = await editAt({ id: "d1", widgetId: "w1" });
	await page.getByRole("radio", { name: "Data table" }).click();
	await saveButton().click();
	const { widget, frame } = await landed(app, "d1");
	expect(widget).toEqual({ ...preSpec, type: "data-table" });
	await expect.poll(() => focusedIn(frame)).toBe(true);
	await userEvent.keyboard("{Control>}z{/Control}");
	expect(app.current.session!.doc.body.widgets[0]).toEqual(preSpec);
	expect(app.current.session!.canUndo).toBe(false);
});

test("Back while dirty asks to discard; Keep editing stays", async () => {
	const { app } = await editAt({ id: "d1", widgetId: "w1" });
	await page.getByRole("radio", { name: "Data table" }).click();
	history.back();
	await expect.element(discardDialog()).toBeVisible();
	await page.getByRole("button", { name: "Keep editing" }).click();
	await expect.element(discardDialog()).not.toBeInTheDocument();
	await expect.poll(() => location.pathname).toBe(editPath);
	await expect.element(page.getByRole("radio", { name: "Data table" })).toBeChecked();
	// Discard leaves, saving nothing.
	history.back();
	await page.getByRole("button", { name: "Discard" }).click();
	await expect.poll(() => location.pathname).toBe("/workspace/dashboards/d1");
	expect((await app.sessions.get("d1"))!.doc.body.widgets[0]).toEqual(preSpec);
});

test("Save changes whose navigation is refused still asks before a later Back", async () => {
	await editAt({ id: "d1", widgetId: "w1" });
	await page.getByRole("radio", { name: "Data table" }).click();
	// Another blocker, after the page's own, refuses the move to the dashboard.
	const unblock = blockNavigation(() => false);
	try {
		await saveButton().click();
		await expect.element(saveButton()).toBeEnabled();
		expect(location.pathname).toBe(editPath);
	} finally {
		unblock();
	}
	// The saved change isn't asked about; a later one is.
	await page.getByRole("radio", { name: "Chart" }).click();
	history.back();
	await expect.element(discardDialog()).toBeVisible();
	await page.getByRole("button", { name: "Keep editing" }).click();
	await expect.poll(() => location.pathname).toBe(editPath);
});

test("Cancel whose navigation is refused still asks before a later Back", async () => {
	await editAt({ id: "d1", widgetId: "w1" });
	await expect.element(saveButton()).toBeVisible();
	// Stands in for a tab whose earlier entry is another site: Cancel then navigates itself.
	history.replaceState({ ...history.state, _routerIndex: 0 }, "");
	const unblock = blockNavigation(() => false);
	try {
		await page.getByRole("button", { name: "Cancel" }).click();
		await new Promise((r) => setTimeout(r, 100));
		expect(location.pathname).toBe(editPath);
	} finally {
		unblock();
	}
	await page.getByRole("radio", { name: "Data table" }).click();
	history.back();
	await expect.element(discardDialog()).toBeVisible();
	await page.getByRole("button", { name: "Keep editing" }).click();
});

test("a nav link or Cancel while dirty asks to discard; with no changes they just leave", async () => {
	const { app, platform } = await editAt({ id: "d1", widgetId: "w1" });
	// A Get data draft unlike both the widget (Last 30 days) and the edit (Data table).
	await platform.preferences.set(app.space, DRAFT_KEY, {
		type: "chart",
		data: { ...preSpec.data, dateRange: { kind: "trailing", amount: 7, unit: "day" } }
	});
	await page.getByRole("radio", { name: "Data table" }).click();
	await page.getByRole("button", { name: "Cancel" }).click();
	await expect.element(discardDialog()).toBeVisible();
	await page.getByRole("button", { name: "Keep editing" }).click();
	await expect.poll(() => location.pathname).toBe(editPath);
	await page.getByRole("link", { name: "Data Portal" }).click();
	await expect.element(discardDialog()).toBeVisible();
	await page.getByRole("button", { name: "Keep editing" }).click();
	await expect.poll(() => location.pathname).toBe(editPath);
	await page.getByRole("link", { name: "Data Portal" }).click();
	await page.getByRole("button", { name: "Discard" }).click();
	await expect.poll(() => location.pathname).toBe("/workspace/data");
	// /data starts from the Get data draft, not the widget or the discarded edit.
	await expect.element(page.getByRole("heading", { name: "Data Portal" })).toBeVisible();
	await expect.element(page.getByRole("radio", { name: "Chart" })).toBeChecked();
	await expect
		.element(page.getByRole("button", { name: /^Dates/ }))
		.toHaveTextContent("Last 7 days");
	expect(saveButton().query()).toBeNull();
});

test("Cancel with no changes goes back without asking", async () => {
	await editAt({ id: "d1", widgetId: "w1" });
	await expect.element(saveButton()).toBeVisible();
	await page.getByRole("button", { name: "Cancel" }).click();
	await expect.poll(() => location.pathname).toBe("/workspace/dashboards/d1");
	expect(discardDialog().query()).toBeNull();
});

test("Cancel on a page opened on its link goes to the dashboard, not off the app", async () => {
	await editAt({ id: "d1", widgetId: "w1" });
	await expect.element(saveButton()).toBeVisible();
	// Stands in for a tab whose earlier entry is another site: the router's first entry.
	await navigate("/dashboards");
	await navigate("/dashboards/:id/widgets/:widgetId/edit", {
		params: { id: "d1", widgetId: "w1" }
	});
	history.replaceState({ ...history.state, _routerIndex: 0 }, "");
	await expect.element(saveButton()).toBeVisible();
	await page.getByRole("button", { name: "Cancel" }).click();
	await expect.poll(() => location.pathname).toBe("/workspace/dashboards/d1");
});

// Opened from a Map ("Show in a chart") -------------------------------------------------------

/**
 * What a Map hands the Data Portal: a Chart of the searched monitors `ids` (its marks, on the
 * air-quality layer) over the Map's 30 days.
 */
function handOff(ids: string[], extra: Partial<{ leftOut: number; skip: string }> = {}) {
	return {
		draft: {
			type: "chart",
			data: {
				dateRange: { kind: "trailing", amount: 30, unit: "day" },
				layers: [{ dataset: "air-quality", entryType: "pm25", monitors: ids }]
			}
		},
		leftOut: 0,
		...extra
	};
}

/**
 * A hand-off whose Where holds the counties `codes` (a selection): over the Chart's cap, the keep
 * dialog opens (monitors are never over a cap).
 */
function areasHandOff(codes: string[]) {
	return {
		draft: {
			type: "chart",
			data: {
				dateRange: { kind: "trailing", amount: 30, unit: "day" },
				selection: { kind: "regions", ids: codes.map((c) => `county:${c}`) },
				layers: [{ dataset: "air-quality", entryType: "pm25" }]
			}
		},
		leftOut: 0
	};
}

const SEVEN = ["r1", "r2", "r3", "r4", "r5", "r6", "r7"];

/**
 * The whole app over dashboards `names` (d1, …), on d1, then opened by `go` (as the Map's items
 * open it), with every preference write recorded.
 */
async function fromMap(
	go: () => Promise<unknown>,
	{ names = ["Home"], lastOpened, onDashboard = true } = {} as {
		names?: string[];
		lastOpened?: string;
		onDashboard?: boolean;
	}
) {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	for (const [i, name] of names.entries()) {
		const doc: Dashboard = {
			...blankDashboard(new Date(Date.UTC(2026, 10, 1 + i))),
			id: `d${i + 1}`,
			name
		};
		await platform.documents.commit(app.space, {
			docId: doc.id,
			baseVersion: null,
			doc,
			entries: []
		});
	}
	if (lastOpened) await platform.preferences.set(app.space, LAST_OPENED_KEY, lastOpened);
	await app.index.refresh();
	const writes = vi.spyOn(platform.preferences, "set");
	const context = new Map([[APP_CONTEXT_KEY, app]]);
	if (onDashboard) {
		await navigate("/dashboards/:id", { params: { id: "d1" } });
		const screen = await render(App, { context });
		await go();
		return { app, platform, writes, screen, context };
	}
	await go();
	const screen = await render(App, { context });
	return { app, platform, writes, screen, context };
}

const toNewWidget = (state: unknown) => () =>
	navigate("/dashboards/:id/widgets/new", { params: { id: "d1" }, state: { getData: state } });
const draftWrites = (writes: ReturnType<typeof vi.spyOn>) =>
	writes.mock.calls.filter((call: unknown[]) => call[1] === DRAFT_KEY);
const newPath = "/workspace/dashboards/d1/widgets/new";

test("a hand-off opens on its Chart with its places; the saved draft is never written", async () => {
	const { writes } = await fromMap(toNewWidget(handOff(["r1", "r2"])));
	await expect.element(page.getByRole("radio", { name: "Chart" })).toBeChecked();
	// No note: nothing was left out.
	expect(page.getByText(/aren't shown on the map/).query()).toBeNull();
	// An edit, and the page being hidden, write nothing either.
	await page.getByRole("radio", { name: "Data table" }).click();
	await expect.element(page.getByRole("radio", { name: "Data table" })).toBeChecked();
	// "pagehide" flushes a pending save at once, so nothing pending was written either.
	window.dispatchEvent(new PageTransitionEvent("pagehide"));
	expect(draftWrites(writes)).toEqual([]);
	// Leaving with that edit asks.
	await page.getByRole("link", { name: "Data Portal" }).click();
	await expect.element(discardDialog()).toBeVisible();
	await page.getByRole("button", { name: "Discard" }).click();
	await expect.poll(() => location.pathname).toBe("/workspace/data");
	expect(draftWrites(writes)).toEqual([]);
});

test("a hand-off with hidden marks says how many were left out", async () => {
	await fromMap(toNewWidget(handOff(["r1", "r2"], { leftOut: 2 })));
	const note = page.getByText("2 marked monitors aren't shown on the map, so they were left out.");
	await expect.element(note).toBeVisible();
	// It stays through other edits.
	await page.getByRole("radio", { name: "Data table" }).click();
	await expect.element(note).toBeVisible();
});

test("one hidden mark is counted in the singular", async () => {
	await fromMap(toNewWidget(handOff(["r1"], { leftOut: 1 })));
	await expect
		.element(page.getByText("1 marked monitor isn't shown on the map, so it was left out."))
		.toBeVisible();
});

test("Add from a hand-off adds the Chart without asking, even after an edit", async () => {
	const { app, writes } = await fromMap(toNewWidget(handOff(["r1", "r2"])));
	await page.getByRole("radio", { name: "Data table" }).click();
	await addButton("Home").click();
	const { widget } = await landed(app, "d1");
	expect(widget.type).toBe("data-table");
	expect(widget.data.layers[0].monitors).toEqual(["r1", "r2"]);
	expect(widget.data.selection).toBeUndefined();
	expect(discardDialog().query()).toBeNull();
	expect(draftWrites(writes)).toEqual([]);
});

test("a hand-off with 30 places opens with all 30 and no keep dialog; Back doesn't ask", async () => {
	const thirty = Array.from({ length: 30 }, (_, i) => `r${i + 1}`);
	await fromMap(toNewWidget(areasHandOff(thirty)));
	await expect.poll(() => location.pathname).toBe(newPath);
	await expect.element(page.getByTestId("where-summary")).toHaveTextContent("30 places");
	expect(page.getByRole("dialog").query()).toBeNull();
	await expect.element(page.getByRole("radio", { name: "Chart" })).toBeChecked();
	history.back();
	await expect.poll(() => location.pathname).toBe("/workspace/dashboards/d1");
	expect(discardDialog().query()).toBeNull();
});

test("a hand-off beside a value JSON can't hold (a BigInt) opens without an error", async () => {
	await fromMap(toNewWidget({ ...areasHandOff(["r1", "r2"]), extra: 1n }));
	await expect.element(page.getByRole("heading", { name: "Data Portal" })).toBeVisible();
	await expect.element(page.getByTestId("where-summary")).toHaveTextContent("2 places");
});

test("a hand-off that doesn't parse opens the saved draft, as a plain visit does", async () => {
	const { platform, app } = await fromMap(() => Promise.resolve());
	reported.length = 0;
	await platform.preferences.set(app.space, DRAFT_KEY, {
		type: "data-table",
		data: {
			dateRange: { kind: "trailing", amount: 7, unit: "day" },
			place: FRESNO,
			layers: [{ dataset: "air-quality", entryType: "pm25" }]
		}
	});
	await toNewWidget({ draft: { type: 5 }, leftOut: -1 })();
	await expect.element(page.getByRole("heading", { name: "Data Portal" })).toBeVisible();
	await expect.element(page.getByRole("radio", { name: "Data table" })).toBeChecked();
	await expect
		.element(page.getByRole("button", { name: /^Dates/ }))
		.toHaveTextContent("Last 7 days");
	expect(page.getByRole("dialog").query()).toBeNull();
	expect(reported).toEqual([]);
});

test("a read-only Map dashboard (skip) is kept out of Add to", async () => {
	await fromMap(() => navigate("/data", { state: { getData: handOff(["r1"], { skip: "d1" }) } }), {
		names: ["Home", "School"],
		lastOpened: "d1"
	});
	await expect.element(addButton("Starter dashboard")).toBeVisible();
	await page.getByRole("button", { name: "Add to another dashboard" }).click();
	const items = page.getByRole("menuitem");
	await expect.element(items.first()).toBeVisible();
	expect(items.elements().map((e) => e.textContent?.trim())).toEqual(["School", "New dashboard"]);
});

test("a reload starts from the Map's Chart again, and the saved draft stays untouched", async () => {
	const { screen, context, writes } = await fromMap(toNewWidget(handOff(["r1", "r2"])));
	await expect.element(page.getByRole("radio", { name: "Chart" })).toBeChecked();
	await page.getByRole("radio", { name: "Data table" }).click();
	await expect.element(page.getByRole("radio", { name: "Data table" })).toBeChecked();
	// A reload: the page goes, and the app starts again on the same history entry.
	window.dispatchEvent(new PageTransitionEvent("pagehide"));
	screen.unmount();
	await render(App, { context });
	await expect.element(page.getByRole("radio", { name: "Chart" })).toBeChecked();
	// "pagehide" flushes a pending save at once: nothing waits on a timer.
	window.dispatchEvent(new PageTransitionEvent("pagehide"));
	expect(draftWrites(writes)).toEqual([]);
});

test("the Data Portal link from a visit from a Map starts a plain visit", async () => {
	await fromMap(() =>
		navigate("/data", { state: { getData: handOff(["r1", "r2"], { leftOut: 2 }) } })
	);
	const note = page.getByText("2 marked monitors aren't shown on the map, so they were left out.");
	await expect.element(note).toBeVisible();
	await page.getByRole("link", { name: "Data Portal" }).click();
	await expect.element(note).not.toBeInTheDocument();
	// Back to the visit from the Map starts from its draft again.
	history.back();
	await expect.element(note).toBeVisible();
});

test("a Map with smoke and fire and a fill: the visit notes them, not the marks", async () => {
	const map: Draft = {
		type: "map",
		data: {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			place: FRESNO,
			layers: [{ dataset: "air-quality", entryType: "pm25" }]
		},
		options: { fill: "zipcode", marks: SEVEN }
	};
	setSmokeAndFire(map.data, true);
	const send = { kind: "monitors" as const, ids: SEVEN, leftOut: 0 };
	const state = showInDraft(map, send, chartType, FIXTURE_CATALOG);
	expect(state.notes?.dropped).toEqual(expect.arrayContaining(["overlays", "fill"]));
	// The marks are the Chart's searched monitors: never over a cap, so no keep dialog.
	expect(state.draft.data.layers[0].monitors).toEqual(SEVEN);
	await fromMap(toNewWidget(state));
	await expect.element(page.getByRole("radio", { name: "Chart" })).toBeChecked();
	expect(page.getByRole("dialog").query()).toBeNull();
	const overlays = page.getByText(m.get_data_overlays_left_out());
	const fill = page.getByText(m.getdata_note_fill_dropped());
	await expect.element(overlays).toBeVisible();
	await expect.element(fill).toBeVisible();
	expect(page.getByText(m.get_data_marks_left_out()).query()).toBeNull();
	expect(page.getByText(/places, so the others were left out/).query()).toBeNull();
	// The next edit clears them, as after Show as.
	await page.getByRole("radio", { name: "Data table" }).click();
	await expect.element(overlays).not.toBeInTheDocument();
});
