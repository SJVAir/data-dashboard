import "../../../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { setShownSelection } from "$lib/calendars/shown-registry";
import { CONTRIBUTION_CALENDAR_TYPE, MONTH_CALENDAR_TYPE } from "$lib/calendars/types";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { setPlatform } from "$lib/platform";
import { createMemoryPlatform } from "$lib/platform/memory";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { chartType } from "$lib/widgets/chart";
import { placeholderType } from "$lib/widgets/placeholder";
import { registerWidgetType } from "$lib/widgets/registry";
import Harness from "$lib/components/dashboard/test-harness/Harness.svelte";
import { contributionCalendarType } from "../contribution";
import { monthCalendarType } from "../month";

const originalUrl = location.href;
beforeEach(async () => {
	await page.viewport(1280, 800);
	// The frames show the placeholder body: only the menu is under test.
	for (const t of [monthCalendarType, contributionCalendarType, chartType]) {
		registerWidgetType({ ...t, load: placeholderType.load });
	}
	registerWidgetType(placeholderType);
});
/** What a mounted calendar records while it shows saved days (the frames show a placeholder). */
let unshow: (() => void) | undefined;
afterEach(() => {
	unshow?.();
	unshow = undefined;
	toast.dismiss();
	history.replaceState(null, "", originalUrl);
});

function calendar(type: string, selected: boolean): WidgetInstance {
	return {
		id: "cal",
		type,
		title: "Days",
		rect: { x: 0, y: 0, w: 6, h: 6 },
		data: {
			dateRange: { kind: "custom", start: "2026-11-01", end: "2026-11-30" },
			...(selected ? { timeSubRange: { start: "2026-11-05", end: "2026-11-08" } } : {}),
			layers: [{ dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id: "a" } }]
		}
	};
}

function dashboard(widget: WidgetInstance): Dashboard {
	return {
		kind: "dashboard",
		schemaVersion: 1,
		id: "d1",
		name: null,
		version: 0,
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-01T00:00:00.000Z",
		body: { widgets: [widget] }
	};
}

async function edit(widget: WidgetInstance) {
	const platform = createMemoryPlatform();
	setPlatform(platform);
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const id = await app.index.createBlank();
	const stored = (await platform.documents.get(app.space, id)) as Dashboard;
	await platform.documents.commit(app.space, {
		docId: id,
		baseVersion: stored.version,
		doc: { ...stored, body: { widgets: [widget] } },
		entries: []
	});
	const session = (await DocumentSession.open(platform, app.space, id, "t2"))!;
	app.current = { session, isStarter: false };
	const sub = widget.data.timeSubRange;
	if (sub) unshow = setShownSelection(widget.id, Symbol("calendar"), sub);
	await render(Harness, { props: {}, context: new Map([[APP_CONTEXT_KEY, app]]) });
	return session;
}

const openMenu = () => page.getByRole("button", { name: "Actions for Days" }).click();
const entry = () => page.getByRole("menuitem", { name: "Open these days in a chart" });

test("a month calendar with a selection offers the chart item, which adds a Chart", async () => {
	const session = await edit(calendar(MONTH_CALENDAR_TYPE, true));
	await openMenu();
	await entry().click();
	await expect.poll(() => session.doc.body.widgets.length).toBe(2);
	const chart = session.doc.body.widgets[1];
	expect(chart.type).toBe("chart");
	expect(chart.data.dateRange).toEqual({ kind: "custom", start: "2026-11-05", end: "2026-11-08" });
});

test("a month calendar without a selection has no chart item", async () => {
	await edit(calendar(MONTH_CALENDAR_TYPE, false));
	await openMenu();
	await expect.element(page.getByRole("menuitem").first()).toBeVisible();
	await expect.element(entry()).not.toBeInTheDocument();
});

test("a contribution calendar with a selection offers the chart item", async () => {
	await edit(calendar(CONTRIBUTION_CALENDAR_TYPE, true));
	await openMenu();
	await expect.element(entry()).toBeVisible();
});

test("a read-only view has no chart item", async () => {
	const platform = createMemoryPlatform();
	setPlatform(platform);
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	history.replaceState(null, "", "/workspace/shared/tok");
	await render(Harness, {
		props: { view: dashboard(calendar(MONTH_CALENDAR_TYPE, true)) },
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
	await openMenu();
	await expect.element(page.getByRole("menuitem", { name: "Fullscreen" })).toBeVisible();
	await expect.element(entry()).not.toBeInTheDocument();
});
