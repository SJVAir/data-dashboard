import "../app.css";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import ConflictDialog from "$lib/components/dialogs/ConflictDialog.svelte";
import { createMemoryPlatform } from "$lib/platform/memory";
import { resolveMenu } from "$lib/actions/resolve";
import { dashboardActions } from "$lib/actions/dashboard";
import { menuScope } from "$lib/actions/scope";
import { APP_CONTEXT_KEY, LAST_OPENED_KEY, initApp } from "$lib/store/app.svelte";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import DashboardList from "./DashboardList.svelte";
import ListHarness from "./test-harness/ListHarness.svelte";

const originalUrl = location.href;
afterEach(() => {
	history.replaceState(null, "", originalUrl);
});

async function setup() {
	let tick = 0;
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1",
		now: () => new Date(Date.UTC(2026, 9, 1, 12, tick++))
	});
	return app;
}

test("list shows dashboards by display name, newest first", async () => {
	const app = await setup();
	await app.index.createBlank();
	await app.index.createBlank();
	await render(DashboardList, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect.element(page.getByRole("heading", { name: "Your dashboards" })).toBeVisible();
	const rows = page.getByRole("listitem").elements();
	expect(rows.map((row) => row.querySelector("a span")?.textContent)).toEqual([
		"Untitled dashboard 2",
		"Untitled dashboard"
	]);
	await expect.element(page.getByText("Updated Oct 1, 2026").first()).toBeVisible();
	await expect
		.element(page.getByRole("button", { name: "Actions for Untitled dashboard 2" }))
		.toBeVisible();
});

test("row menu deletes that dashboard", async () => {
	const app = await setup();
	await app.index.createBlank();
	await render(DashboardList, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await page.getByRole("button", { name: "Actions for Untitled dashboard" }).click();
	await page.getByRole("menuitem", { name: "Delete dashboard" }).click();
	await expect.element(page.getByText("You don't have any dashboards yet.")).toBeVisible();
});

test("empty list offers both create buttons", async () => {
	const app = await setup();
	await render(DashboardList, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect.element(page.getByText("You don't have any dashboards yet.")).toBeVisible();
	await expect.element(page.getByRole("button", { name: "New blank dashboard" })).toBeVisible();
	await expect.element(page.getByRole("button", { name: "New from starter" })).toBeVisible();
});

test("conflict dialog choices call resolveConflict", async () => {
	const app = await setup();
	const resolveConflict = vi.fn<(choice: string) => Promise<string | null>>(async () => null);
	app.current = {
		session: { conflict: { pairs: [] }, resolveConflict } as unknown as DocumentSession,
		isStarter: false
	};
	await render(ConflictDialog, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect
		.element(
			page.getByText(
				"This dashboard was changed in another tab while you were editing the same thing."
			)
		)
		.toBeVisible();
	await page.getByRole("button", { name: "Keep mine" }).click();
	await page.getByRole("button", { name: "Use the other version" }).click();
	await page.getByRole("button", { name: "Save mine as a copy" }).click();
	expect(resolveConflict.mock.calls.map((c) => c[0])).toEqual([
		"keep-mine",
		"use-other",
		"save-copy"
	]);
});

test("conflict dialog can't be dismissed without a choice", async () => {
	const app = await setup();
	const resolveConflict = vi.fn<(choice: string) => Promise<string | null>>(async () => null);
	app.current = {
		session: { conflict: { pairs: [] }, resolveConflict } as unknown as DocumentSession,
		isStarter: false
	};
	await render(ConflictDialog, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect.element(page.getByRole("button", { name: "Keep mine" })).toBeVisible();
	await userEvent.keyboard("{Escape}");
	await userEvent.click(document.body, { position: { x: 2, y: 2 } });
	await expect.element(page.getByRole("button", { name: "Keep mine" })).toBeVisible();
	expect(resolveConflict).not.toHaveBeenCalled();
});

test("row rename leaves the last-opened preference unchanged", async () => {
	const app = await setup();
	const id = await app.index.createBlank();
	await app.platform.preferences.set(app.space, LAST_OPENED_KEY, "elsewhere");
	await render(ListHarness, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await page.getByRole("button", { name: "Actions for Untitled dashboard" }).click();
	await page.getByRole("menuitem", { name: "Rename dashboard…" }).click();
	await page.getByRole("textbox", { name: "Name" }).fill("Renamed");
	await page.getByRole("button", { name: "Save" }).click();
	await expect.poll(() => app.index.names.get(id)).toBe("Renamed");
	expect(await app.platform.preferences.get(app.space, LAST_OPENED_KEY)).toBe("elsewhere");
});

test("duplicating from the list opens the rename dialog on the copy", async () => {
	const app = await setup();
	await app.index.createBlank();
	await render(ListHarness, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await page.getByRole("button", { name: "Actions for Untitled dashboard" }).click();
	await page.getByRole("menuitem", { name: "Duplicate dashboard" }).click();
	await expect.element(page.getByRole("dialog", { name: "Rename dashboard" })).toBeVisible();
	expect(app.index.items).toHaveLength(2);
});

test("a row scope inside the page scope leaves one set of manage actions", async () => {
	const app = await setup();
	const outer = document.createElement("div");
	const inner = document.createElement("div");
	outer.append(inner);
	document.body.append(outer);
	const cleanups = [
		menuScope(dashboardActions(app))(outer),
		menuScope(dashboardActions(app, "row-id"))(inner)
	];
	const items = resolveMenu(inner, { payload: {} });
	for (const id of ["rename-dashboard", "duplicate-dashboard", "delete-dashboard"]) {
		expect(items.filter((item) => item.id === id)).toHaveLength(1);
	}
	for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
	outer.remove();
});
