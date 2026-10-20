import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import type { MenuItem } from "$lib/actions/types";
import Harness from "./test-harness/Harness.svelte";

function setup() {
	const run = vi.fn();
	const inner: MenuItem[] = [{ id: "rename", label: "Rename", group: "widget", run }];
	const outer: MenuItem[] = [{ id: "add", label: "Add widget", group: "dashboard", run: vi.fn() }];
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
