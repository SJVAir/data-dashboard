import "../app.css";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import ConfirmDialog from "$lib/components/dialogs/ConfirmDialog.svelte";
import RenameDialog from "$lib/components/dialogs/RenameDialog.svelte";
import ConflictDialog from "$lib/components/dialogs/ConflictDialog.svelte";
import { createMemoryPlatform } from "$lib/platform/memory";
import { m } from "$lib/paraglide/messages.js";
import { resolveMenu } from "$lib/actions/resolve";
import { dashboardActions } from "$lib/actions/dashboard";
import { menuScope } from "$lib/actions/scope";
import { APP_CONTEXT_KEY, LAST_OPENED_KEY, initApp } from "$lib/store/app.svelte";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { saveFields } from "$lib/sync/merge";
import { accountApp } from "$lib/sync/test-app";
import { ACCOUNT, makeDoc } from "$lib/sync/test-support";
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

test("a dashboard that can't be opened is listed with Download and Delete", async () => {
	const app = await setup();
	await app.platform.documents.commit(app.space, {
		docId: "bad",
		baseVersion: null,
		doc: { kind: "dashboard", schemaVersion: 1, id: "bad" } as never,
		entries: []
	});
	await app.index.refresh();
	await render(DashboardList, {
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
	const row = page.getByTestId("dashboard-row-bad");
	await expect.element(row.getByText("A dashboard that can't be opened")).toBeVisible();
	expect(row.getByRole("link").elements()).toHaveLength(0);
	await expect.element(row.getByRole("button", { name: "Download" })).toBeVisible();
	await row.getByRole("button", { name: "Delete" }).click();
	await render(ConfirmDialog);
	await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
	await vi.waitFor(async () =>
		expect(await app.platform.documents.get(app.space, "bad")).toBeUndefined()
	);
});

test("unreadable rows tell their buttons apart", async () => {
	const app = await setup();
	for (const [id, updatedAt] of [
		["bad1", "2026-10-01T12:00:00.000Z"],
		["bad2", undefined]
	] as const) {
		await app.platform.documents.commit(app.space, {
			docId: id,
			baseVersion: null,
			doc: { kind: "dashboard", schemaVersion: 1, id, updatedAt } as never,
			entries: []
		});
	}
	await app.index.refresh();
	await render(DashboardList, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	const describedBy = (id: string) => {
		const button = page.getByTestId(`dashboard-row-${id}`).getByRole("button", { name: "Delete" });
		const ids = button.element().getAttribute("aria-describedby")!.split(" ");
		return ids.map((i) => document.getElementById(i)?.textContent).join(" ");
	};
	expect(describedBy("bad1")).toContain("Last saved Oct 1, 2026");
	expect(describedBy("bad2")).toContain("Reference bad2");
	expect(describedBy("bad1")).not.toBe(describedBy("bad2"));
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

test("saving mine as a copy opens the copy with the rename dialog", async () => {
	const app = await setup();
	const copyId = await app.index.createBlank();
	const resolveConflict = vi.fn<(choice: string) => Promise<string | null>>(async () => copyId);
	app.current = {
		session: { conflict: { pairs: [] }, resolveConflict } as unknown as DocumentSession,
		isStarter: false
	};
	await render(RenameDialog);
	await render(ConflictDialog, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await page.getByRole("button", { name: "Save mine as a copy" }).click();
	await expect.element(page.getByRole("dialog", { name: "Rename dashboard" })).toBeVisible();
	// Leave no dialog open for the tests after this one.
	app.current = { session: null, isStarter: false };
	await userEvent.keyboard("{Escape}");
	await expect
		.element(page.getByRole("dialog", { name: "Rename dashboard" }))
		.not.toBeInTheDocument();
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

test("the list marks dashboards only in this browser", async () => {
	const { app, refuseSaves, worker } = await accountApp(["d1", "d2"]);
	try {
		// The first upload in the sweep is refused; the other reaches the account.
		refuseSaves.push({ code: "limit_documents", status: 403 });
		await render(DashboardList, { context: new Map([[APP_CONTEXT_KEY, app]]) });
		worker.start();
		await expect
			.poll(() =>
				Object.values(worker.states)
					.map((s) => s.state)
					.sort()
			)
			.toEqual(["held", "synced"]);
		const held = Object.entries(worker.states).find(([, s]) => s.state === "held")![0];
		const synced = held === "d1" ? "d2" : "d1";
		const heldRow = page.getByTestId(`dashboard-row-${held}`);
		await expect.element(heldRow.getByText("Only in this browser")).toBeVisible();
		await expect.element(heldRow.getByText(m.sync_refused_limit_documents())).toBeVisible();
		expect(
			page.getByTestId(`dashboard-row-${synced}`).getByText("Only in this browser").query()
		).toBeNull();
		// The link is named by the dashboard alone; the status describes it.
		const link = heldRow.getByRole("link").element();
		expect(link.textContent).not.toContain("Only in this browser");
		const status = document.getElementById(link.getAttribute("aria-describedby") ?? "");
		expect(status?.textContent).toContain("Only in this browser");
		expect(status?.textContent).toContain(m.sync_refused_limit_documents());
		await expect.element(heldRow.getByRole("link")).toHaveAccessibleName(/^Untitled dashboard/);
		await expect
			.element(heldRow.getByRole("link"))
			.toHaveAccessibleDescription(`Only in this browser ${m.sync_refused_limit_documents()}`);
		expect(
			page.getByTestId(`dashboard-row-${synced}`).getByRole("link").element()
		).not.toHaveAttribute("aria-describedby");
	} finally {
		worker.stop();
	}
});

test("the list shows a dashboard the sync worker stores from the server", async () => {
	const { app, fake, worker } = await accountApp(["d1"]);
	try {
		await fake.save("d9", {
			...saveFields({ ...makeDoc("d9"), name: "From the laptop" }),
			baseVersion: null,
			changes: [],
			accountId: ACCOUNT,
			buildId: "other-build",
			snapshot: null
		});
		await render(DashboardList, { context: new Map([[APP_CONTEXT_KEY, app]]) });
		await expect.element(page.getByTestId("dashboard-row-d1")).toBeVisible();
		// The first poll stores it here.
		worker.start();
		await expect.element(page.getByText("From the laptop")).toBeVisible();
	} finally {
		worker.stop();
	}
});

async function restoreItem(app: Awaited<ReturnType<typeof accountApp>>["app"]) {
	const session = (await DocumentSession.open(app.platform, app.space, "d1", "t1", {}))!;
	app.current = { session, isStarter: false };
	return dashboardActions(app)({ target: document.body, payload: {} }).find(
		(item) => item.id === "restore-version"
	);
}

test("Restore an earlier version shows for a synced dashboard without a kept original", async () => {
	const { app, worker } = await accountApp(["d1"]);
	try {
		worker.start();
		await expect.poll(() => worker.states["d1"]?.onServer).toBe(true);
		expect(await app.platform.originals.get(app.space, "d1")).toBeUndefined();
		expect(await restoreItem(app)).toBeDefined();
	} finally {
		app.current.session?.dispose();
		worker.stop();
	}
});

test("it doesn't show for a dashboard that never synced and has no kept original", async () => {
	const { app, worker } = await accountApp(["d1"]);
	try {
		expect(worker.states["d1"]?.onServer).not.toBe(true);
		expect(await restoreItem(app)).toBeUndefined();
	} finally {
		app.current.session?.dispose();
	}
});
