import "../../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { setPlatform } from "$lib/platform";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { setShownSelection } from "$lib/calendars/shown-registry";
import { MONTH_CALENDAR_TYPE } from "$lib/calendars/types";
import { monthCalendarType } from "$lib/widgets/calendars/month";
import { MAP_TYPE, mapType } from "$lib/widgets/map";
import { setMapSend } from "$lib/widgets/map/send-registry";
import { placeholderType } from "$lib/widgets/placeholder";
import { registerWidgetType } from "$lib/widgets/registry";
import type { MenuItem } from "$lib/actions/types";
import { m } from "$lib/paraglide/messages.js";
import { navigate } from "../../../router";
import Harness from "./test-harness/Harness.svelte";

const TYPE = "viewer-menu-test";
registerWidgetType({
	...placeholderType,
	type: TYPE,
	menu: () => {
		const item = (id: string, label: string, forViewers?: boolean): MenuItem => ({
			id,
			label,
			group: "widget",
			forViewers,
			run: () => {}
		});
		return [item("open", "Open for viewers", true), item("edit", "Editors only")];
	}
});

const originalUrl = location.href;
beforeEach(async () => {
	await page.viewport(1280, 800);
	history.replaceState(null, "", "/workspace/shared/tok");
});
afterEach(() => history.replaceState(null, "", originalUrl));

function doc(): Dashboard {
	const w = (id: string, x: number, minimized?: boolean): WidgetInstance => ({
		id,
		type: TYPE,
		title: id === "a" ? "Shown" : "Parked",
		rect: { x, y: 0, w: 6, h: 4 },
		data: { layers: [] },
		...(minimized ? { minimized: { order: 0 } } : {})
	});
	return {
		kind: "dashboard",
		schemaVersion: 1,
		id: "shared-1",
		name: "Class dashboard",
		version: 3,
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-01T00:00:00.000Z",
		body: { widgets: [w("a", 0), w("b", 6, true)] }
	};
}

const items = () =>
	[...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim());

async function renderView() {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	await render(Harness, {
		props: { view: doc() },
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
}

test("a read-only frame lists only the type items that opt in", async () => {
	await renderView();
	await page.getByRole("button", { name: "Actions for Shown" }).click();
	await expect.element(page.getByRole("menuitem", { name: "Open for viewers" })).toBeVisible();
	expect(items()).toEqual(["Open for viewers", "Fullscreen"]);
	await userEvent.keyboard("{Escape}");
});

test("a minimized widget's menu on a read-only view lists them too", async () => {
	await renderView();
	await page.getByRole("button", { name: "Actions for Parked" }).click();
	await expect.element(page.getByRole("menuitem", { name: "Open for viewers" })).toBeVisible();
	expect(items()).toEqual(["Open for viewers", "Fullscreen"]);
	await userEvent.keyboard("{Escape}");
});

test("a read-only month calendar showing a selection has no chart item (D20)", async () => {
	registerWidgetType({ ...monthCalendarType, load: placeholderType.load });
	const view = doc();
	view.body.widgets = [
		{
			id: "cal",
			type: MONTH_CALENDAR_TYPE,
			title: "Days",
			rect: { x: 0, y: 0, w: 6, h: 6 },
			data: {
				dateRange: { kind: "custom", start: "2026-11-01", end: "2026-11-30" },
				timeSubRange: { start: "2026-11-05", end: "2026-11-08" },
				place: { kind: "monitor", id: "a" },
				layers: [{ dataset: "air-quality", entryType: "pm25" }]
			}
		}
	];
	const unshow = setShownSelection("cal", Symbol("calendar"), {
		start: "2026-11-05",
		end: "2026-11-08"
	});
	try {
		const platform = createMemoryPlatform();
		setPlatform(platform);
		const app = await initApp(platform, {
			channel: createMemoryTabHub().channel(),
			tabId: "t1"
		});
		await render(Harness, { props: { view }, context: new Map([[APP_CONTEXT_KEY, app]]) });
		await page.getByRole("button", { name: "Actions for Days" }).click();
		await expect.element(page.getByRole("menuitem", { name: "Fullscreen" })).toBeVisible();
		expect(items()).toEqual(["Download data (CSV)", "Fullscreen"]);
		await userEvent.keyboard("{Escape}");
	} finally {
		unshow();
	}
});

test("a read-only fullscreen Map has a ⋯ button while it has a mark to send (D6, D20)", async () => {
	const view = doc();
	view.body.widgets = [
		{
			id: "map",
			type: MAP_TYPE,
			title: "Valley",
			rect: { x: 0, y: 0, w: 6, h: 6 },
			data: { layers: [] }
		}
	];
	await navigate("/shared/tok" as "/", {
		search: { widget: "map" },
		replace: true,
		scrollToTop: false
	});
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	// After initApp, which registers the real Map: no Map mounts, so the only entry is the test's.
	registerWidgetType({ ...mapType, load: placeholderType.load });
	await render(Harness, { props: { view }, context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect
		.element(page.getByRole("button", { name: m.widget_exit_fullscreen() }))
		.toBeVisible();
	await expect.element(page.getByText(m.widget_placeholder_body())).toBeVisible();
	const button = page.getByRole("button", { name: "Actions for Valley" });
	// No mark to send: nothing in the menu, so no button.
	expect(document.querySelector('[aria-label="Actions for Valley"]')).toBeNull();
	const draft = () => ({ type: MAP_TYPE, data: { layers: [] } });
	const clear = setMapSend("map", Symbol("map"), { marks: ["a"], leftOut: 0, draft });
	try {
		await button.click();
		await expect.element(page.getByRole("menuitem", { name: "Show in a chart" })).toBeVisible();
		expect(items()).toEqual(expect.arrayContaining(["Show in a chart", "Show in a table"]));
		await userEvent.keyboard("{Escape}");
	} finally {
		clear();
	}
	// The marks are gone: so is the button.
	await expect.poll(() => document.querySelector('[aria-label="Actions for Valley"]')).toBeNull();
});
