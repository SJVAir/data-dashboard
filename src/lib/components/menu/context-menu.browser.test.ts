import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import type { MenuItem } from "$lib/actions/types";
import Harness from "./test-harness/Harness.svelte";

function setup() {
	const run = vi.fn();
	const inner: MenuItem[] = [{ id: "rename", label: "Rename", group: "widget", run }];
	const outer: MenuItem[] = [
		{ id: "add", label: "Add widget", group: "dashboard", bubbles: true, run: vi.fn() }
	];
	return { run, inner, outer };
}

test("right-click inside a scope shows its items", async () => {
	const { inner, outer } = setup();
	await render(Harness, { inner, outer });
	await page.getByTestId("focusable").click({ button: "right" });
	await expect.element(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
	await expect.element(page.getByRole("menuitem", { name: "Add widget" })).toBeVisible();
});

test("Shift+F10 on a focused element opens the same menu", async () => {
	const { inner, outer } = setup();
	await render(Harness, { inner, outer });
	(page.getByTestId("focusable").element() as HTMLElement).focus();
	await userEvent.keyboard("{Shift>}{F10}{/Shift}");
	await expect.element(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
	await expect.element(page.getByRole("menuitem", { name: "Add widget" })).toBeVisible();
});

test("selecting an item calls run", async () => {
	const { run, inner, outer } = setup();
	await render(Harness, { inner, outer });
	await page.getByTestId("focusable").click({ button: "right" });
	await page.getByRole("menuitem", { name: "Rename" }).click();
	expect(run).toHaveBeenCalledTimes(1);
	expect(run.mock.calls[0][0].target).toBe(page.getByTestId("focusable").element());
});

test("openMenuFor renders the same items in a dropdown", async () => {
	const { inner, outer } = setup();
	await render(Harness, { inner, outer });
	await page.getByRole("button", { name: "More" }).click();
	await expect.element(page.getByRole("menuitem", { name: "Add widget" })).toBeVisible();
});

test("openMenuFor passes its payload to run", async () => {
	const run = vi.fn();
	const outer: MenuItem[] = [{ id: "add", label: "Add widget", group: "d", run }];
	await render(Harness, { inner: [], outer, payload: { widgetId: "w1" } });
	await page.getByRole("button", { name: "More" }).click();
	await page.getByRole("menuitem", { name: "Add widget" }).click();
	expect(run.mock.calls[0][0].payload).toEqual({ widgetId: "w1" });
});

test("openMenuFor passes the event that opened it to run", async () => {
	const run = vi.fn();
	const outer: MenuItem[] = [{ id: "add", label: "Add widget", group: "d", run }];
	await render(Harness, { inner: [], outer });
	await page.getByRole("button", { name: "More" }).click();
	await page.getByRole("menuitem", { name: "Add widget" }).click();
	expect(run.mock.calls[0][0].event).toBeInstanceOf(MouseEvent);
	expect(run.mock.calls[0][0].event.type).toBe("click");
});

test("focus returns to the ⋯ button after Escape", async () => {
	const { inner, outer } = setup();
	await render(Harness, { inner, outer });
	const more = page.getByRole("button", { name: "More" });
	await more.click();
	await expect.element(page.getByRole("menuitem", { name: "Add widget" })).toBeVisible();
	await userEvent.keyboard("{Escape}");
	await expect.element(more).toHaveFocus();
});

test("a touch long-press doesn't open the context menu", async () => {
	const { inner, outer } = setup();
	await render(Harness, { inner, outer });
	const el = page.getByTestId("focusable").element();
	const rect = el.getBoundingClientRect();
	const at = { clientX: rect.left + 2, clientY: rect.top + 2 };
	el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", ...at }));
	// Past bits-ui's own long-press timer (700 ms), and the `contextmenu` Android raises.
	await new Promise((r) => setTimeout(r, 900));
	el.dispatchEvent(
		new PointerEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
			pointerType: "touch",
			...at
		})
	);
	el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", ...at }));
	await new Promise((r) => setTimeout(r, 100));
	expect(page.getByRole("menu").query()).toBeNull();

	// A mouse right-click afterwards still opens it.
	await page.getByTestId("focusable").click({ button: "right" });
	await expect.element(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
});

test("a pending afterMenuClose callback doesn't outlive its host", async () => {
	const { afterMenuClose } = await import("./menu-state.svelte");
	const { inner, outer } = setup();
	const stale = vi.fn();
	const first = await render(Harness, { inner, outer });
	afterMenuClose(stale);
	first.unmount();

	await render(Harness, { inner, outer });
	const more = page.getByRole("button", { name: "More" });
	await more.click();
	await expect.element(page.getByRole("menuitem", { name: "Add widget" })).toBeVisible();
	await userEvent.keyboard("{Escape}");
	await expect.element(more).toHaveFocus();
	expect(stale).not.toHaveBeenCalled();
});
