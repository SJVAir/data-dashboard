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
import { placeholderType } from "$lib/widgets/placeholder";
import { registerWidgetType } from "$lib/widgets/registry";
import type { MenuItem } from "$lib/actions/types";
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
				layers: [{ dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id: "a" } }]
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
