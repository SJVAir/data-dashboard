import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import type { Change } from "$lib/changes/types";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp, type AppContext } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import TopNav from "./TopNav.svelte";

const rename = (to: string): Change => ({
	op: "setField",
	target: { path: "name" },
	from: null,
	to
});

async function setup() {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const id = await app.index.createBlank();
	const session = (await app.sessions.get(id))!;
	app.current = { session, isStarter: false };
	return { app, id, session };
}

function renderNav(app: AppContext) {
	return render(TopNav, { context: new Map([[APP_CONTEXT_KEY, app]]) });
}

let input: HTMLInputElement | null = null;
afterEach(() => {
	input?.remove();
	input = null;
});

test("nav shows the app name, picker, saved status, and undo/redo", async () => {
	const { app } = await setup();
	await renderNav(app);
	const nav = page.getByRole("navigation", { name: "Main" });
	await expect.element(nav.getByText("SJVAir Workspace")).toBeVisible();
	await expect.element(nav.getByRole("link", { name: "Dashboards" })).toBeVisible();
	await expect.element(nav.getByRole("button", { name: "Untitled dashboard" })).toBeVisible();
	await expect.element(nav.getByText("Saved")).toBeVisible();
	await expect.element(nav.getByRole("button", { name: "Undo" })).toBeVisible();
	await expect.element(nav.getByRole("button", { name: "Redo" })).toBeVisible();
});

test("undo shortcut ignored in text inputs", async () => {
	const { app, session } = await setup();
	await renderNav(app);
	session.apply(rename("Home"));
	input = document.createElement("input");
	document.body.append(input);
	input.focus();
	await userEvent.keyboard("{Control>}z{/Control}");
	expect(session.canUndo).toBe(true);
	expect(session.doc.name).toBe("Home");

	input.blur();
	await userEvent.keyboard("{Control>}z{/Control}");
	expect(session.canUndo).toBe(false);
	expect(session.doc.name).toBeNull();
	await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
	expect(session.doc.name).toBe("Home");
});

test("undo button undoes the last change and is disabled when nothing to undo", async () => {
	const { app, session } = await setup();
	await renderNav(app);
	const undo = page.getByRole("button", { name: "Undo" });
	const redo = page.getByRole("button", { name: "Redo" });
	await expect.element(undo).toBeDisabled();
	await expect.element(redo).toBeDisabled();

	session.apply(rename("Home"));
	await expect.element(undo).toBeEnabled();
	await undo.click();
	expect(session.doc.name).toBeNull();
	await expect.element(undo).toBeDisabled();
	await expect.element(redo).toBeEnabled();
});

test("picker lists dashboards by display name with the current one marked", async () => {
	const { app, id, session } = await setup();
	const other = await app.index.createBlank();
	session.apply(rename("Home"));
	await session.flush();
	await expect.poll(() => app.index.names.get(id)).toBe("Home");
	await renderNav(app);

	await page.getByRole("button", { name: "Home" }).click();
	const current = page.getByRole("menuitem", { name: "Home" });
	const untitled = page.getByRole("menuitem", { name: "Untitled dashboard" });
	await expect.element(current).toHaveAttribute("aria-current", "page");
	await expect.element(untitled).not.toHaveAttribute("aria-current");
	await expect.element(untitled).toHaveAttribute("href", `/workspace/dashboards/${other}`);
	await expect.element(page.getByRole("menuitem", { name: "All dashboards" })).toBeVisible();
});

test("picker lists the registered dashboard actions", async () => {
	const { app } = await setup();
	await renderNav(app);
	await page.getByRole("button", { name: "Untitled dashboard" }).click();
	for (const name of [
		"New blank dashboard",
		"New from starter",
		"Duplicate dashboard",
		"Rename dashboard…",
		"Delete dashboard"
	]) {
		await expect.element(page.getByRole("menuitem", { name })).toBeVisible();
	}
	await expect.element(page.getByRole("menuitem", { name: "Add widget" })).not.toBeInTheDocument();
});
