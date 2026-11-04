import "../../app.css";
import { afterEach, describe, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { commands, page, userEvent } from "vitest/browser";
import type { MenuItem } from "$lib/actions/types";
import Harness from "$lib/components/menu/test-harness/Harness.svelte";
import HelpMenu from "$lib/components/shell/HelpMenu.svelte";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";

declare module "vitest/browser" {
	interface BrowserCommands {
		setColorScheme: (scheme: "light" | "dark" | null) => Promise<void>;
	}
}

/** A token's color, resolved the way the browser resolves it in an outline or a shadow. */
function tokenColor(token: string): string {
	const probe = document.createElement("span");
	probe.style.color = `var(${token})`;
	document.body.append(probe);
	const color = getComputedStyle(probe).color;
	probe.remove();
	return color;
}

/** The focused menu item draws the focus ring inside itself: sky outline, inset --ring-edge. */
function expectMenuFocusCue() {
	const el = document.activeElement as HTMLElement;
	expect(el.getAttribute("role") ?? "").toMatch(/^menuitem/);
	expect(el.matches(":focus-visible")).toBe(true);
	const style = getComputedStyle(el);
	expect(style.outlineStyle).toBe("solid");
	expect(style.outlineWidth).toBe("2px");
	expect(style.outlineColor).toBe(tokenColor("--ring"));
	expect(style.boxShadow).toContain(tokenColor("--ring-edge"));
	expect(style.boxShadow).toContain("inset");
}

const items: MenuItem[] = [
	{ id: "rename", label: "Rename", group: "widget", run: () => {} },
	{ id: "remove", label: "Remove", group: "widget", run: () => {} }
];
const outer: MenuItem[] = [{ id: "add", label: "Add widget", group: "dashboard", run: () => {} }];

async function helpMenu() {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1",
		loadSync: null
	});
	await render(HelpMenu, { context: new Map([[APP_CONTEXT_KEY, app]]) });
}

describe.each(["light", "dark"] as const)("keyboard focus in menus (%s)", (scheme) => {
	afterEach(async () => {
		document.documentElement.removeAttribute("data-theme");
		await commands.setColorScheme(null);
	});

	test("a context menu item shows the ring", async () => {
		await commands.setColorScheme(scheme);
		await render(Harness, { inner: items, outer });
		(page.getByTestId("focusable").element() as HTMLElement).focus();
		await userEvent.keyboard("{Shift>}{F10}{/Shift}");
		await expect.element(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
		await userEvent.keyboard("{ArrowDown}");
		await expect.poll(() => document.activeElement?.getAttribute("role")).toBe("menuitem");
		expectMenuFocusCue();
	});

	test("a dropdown item shows the ring", async () => {
		await commands.setColorScheme(scheme);
		await render(Harness, { inner: items, outer });
		(page.getByRole("button", { name: "More" }).element() as HTMLElement).focus();
		await userEvent.keyboard("{Enter}");
		await expect.element(page.getByRole("menuitem", { name: "Add widget" })).toBeVisible();
		await expect.poll(() => document.activeElement?.getAttribute("role")).toBe("menuitem");
		expectMenuFocusCue();
	});

	test("a radio item shows the ring", async () => {
		await commands.setColorScheme(scheme);
		await helpMenu();
		(page.getByRole("button", { name: "Help" }).element() as HTMLElement).focus();
		await userEvent.keyboard("{Enter}");
		await expect.element(page.getByRole("menuitemradio", { name: "Light" })).toBeVisible();
		for (
			let i = 0;
			i < 6 && document.activeElement?.getAttribute("role") !== "menuitemradio";
			i++
		) {
			await userEvent.keyboard("{ArrowDown}");
		}
		expect(document.activeElement?.getAttribute("role")).toBe("menuitemradio");
		expectMenuFocusCue();
	});
});
