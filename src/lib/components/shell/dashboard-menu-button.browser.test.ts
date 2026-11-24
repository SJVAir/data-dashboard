import "../../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import type { Dashboard } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { PLACEHOLDER_TYPE } from "$lib/widgets/placeholder";
import App from "../../../App.svelte";
import Harness from "../dashboard/test-harness/Harness.svelte";

const originalUrl = location.href;
beforeEach(async () => {
	await page.viewport(1280, 800);
});
afterEach(() => history.replaceState(null, "", originalUrl));

const more = () => page.getByRole("button", { name: "Dashboard actions" });
const menuItems = () =>
	[...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim());

async function setup() {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	const id = await app.index.createBlank();
	const session = (await app.sessions.get(id))!;
	session.apply({
		op: "addWidget",
		target: { widgetId: "a" },
		widget: {
			id: "a",
			type: PLACEHOLDER_TYPE,
			title: "Readings",
			rect: { x: 0, y: 0, w: 6, h: 4 },
			data: { layers: [] }
		},
		index: 0
	});
	app.current = { session, isStarter: false };
	return { app, id, session };
}

const context = (app: Awaited<ReturnType<typeof setup>>["app"]) =>
	new Map([[APP_CONTEXT_KEY, app]]);

test("the ⋯ shows on an own dashboard and opens the grid's menu", async () => {
	const { app } = await setup();
	await render(Harness, { props: {}, context: context(app) });
	await more().click();
	await expect.element(page.getByRole("menuitem", { name: /^Add widget/ })).toBeVisible();
	const fromButton = menuItems();
	await userEvent.keyboard("{Escape}");
	await expect.element(more()).toHaveFocus();
	const grid = document.querySelector<HTMLElement>('[data-testid="widget-a"]')!.parentElement!;
	const box = grid.getBoundingClientRect();
	await page
		.elementLocator(grid)
		.click({ button: "right", position: { x: box.width * 0.9, y: box.height * 0.5 } });
	await expect.element(page.getByRole("menuitem", { name: /^Add widget/ })).toBeVisible();
	expect(menuItems()).toEqual(fromButton);
});

test("the ⋯ shows on a read-only dashboard", async () => {
	const { app, session } = await setup();
	session.readOnly = "newer";
	await render(Harness, { props: {}, context: context(app) });
	await expect.element(more()).toBeVisible();
});

test("no ⋯ in a shared view", async () => {
	const { app } = await setup();
	const view: Dashboard = {
		kind: "dashboard",
		schemaVersion: 1,
		id: "shared-1",
		name: "Class dashboard",
		version: 1,
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-01T00:00:00.000Z",
		body: { widgets: [] }
	};
	await render(Harness, { props: { view }, context: context(app) });
	await expect.element(page.getByRole("button", { name: "Add widget" })).not.toBeInTheDocument();
	await expect.element(more()).not.toBeInTheDocument();
});

test("the ⋯ is inert while a widget is fullscreen", async () => {
	const { app, id } = await setup();
	history.replaceState(null, "", `/workspace/dashboards/${id}?widget=a`);
	await render(App, { context: context(app) });
	await expect.element(page.getByRole("button", { name: "Exit fullscreen" })).toBeVisible();
	await expect.poll(() => more().element().closest("[inert]")).not.toBeNull();
});

test("the ⋯ follows the dashboard on screen", async () => {
	const first = await setup();
	const screen = await render(Harness, { props: {}, context: context(first.app) });
	await expect.element(more()).toBeVisible();
	await screen.unmount();
	await expect.element(more()).not.toBeInTheDocument();

	const second = await setup();
	await render(Harness, { props: {}, context: context(second.app) });
	await more().click();
	await page.getByRole("menuitem", { name: /^Rename dashboard/ }).click();
	await expect.element(page.getByRole("dialog")).toBeVisible();
	const input = page.getByRole("textbox");
	await input.fill("Second one");
	await userEvent.keyboard("{Enter}");
	await expect.poll(() => second.session.doc.name).toBe("Second one");
	expect(first.session.doc.name).not.toBe("Second one");
});
