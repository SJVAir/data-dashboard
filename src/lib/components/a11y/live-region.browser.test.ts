import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { announce, ANNOUNCE_GAP_MS } from "$lib/a11y/announcer.svelte";
import DialogHarness from "./test-harness/DialogHarness.svelte";

const SELECTOR = '[role="status"][aria-live="polite"][aria-atomic="true"]';

/** Every live region holding `text`. */
function regionsWith(text: string): Element[] {
	return [...document.querySelectorAll(SELECTOR)].filter((r) => r.textContent === text);
}

/** Whether a screen reader can reach `el`: not hidden, and inside the open modal if there is one. */
function reachable(el: Element): boolean {
	if (el.closest('[aria-hidden="true"], [inert]')) return false;
	const modals = [...document.querySelectorAll('[aria-modal="true"]')];
	const top = modals.at(-1);
	return !top || top.contains(el);
}

async function announced(text: string): Promise<Element[]> {
	await expect.poll(() => regionsWith(text).length).toBeGreaterThan(0);
	await new Promise((r) => setTimeout(r, ANNOUNCE_GAP_MS * 2));
	return regionsWith(text);
}

test("with no dialog open, the page's region reads the announcement", async () => {
	await render(DialogHarness);
	announce("plain");
	const regions = await announced("plain");
	expect(regions).toHaveLength(1);
	expect(reachable(regions[0])).toBe(true);
});

test("with a dialog open, the announcement is read once, from inside the dialog", async () => {
	await render(DialogHarness);
	await userEvent.click(page.getByRole("button", { name: "Open outer" }));
	await expect.element(page.getByRole("dialog", { name: "Outer" })).toBeVisible();
	announce("x");
	const regions = await announced("x");
	expect(regions).toHaveLength(1);
	expect(reachable(regions[0])).toBe(true);
});

test("with a dialog over another, only the topmost one reads it", async () => {
	await render(DialogHarness);
	await userEvent.click(page.getByRole("button", { name: "Open outer" }));
	await userEvent.click(page.getByRole("button", { name: "Open inner" }));
	await expect.element(page.getByRole("dialog", { name: "Inner" })).toBeVisible();
	announce("nested");
	const regions = await announced("nested");
	expect(regions).toHaveLength(1);
	expect(reachable(regions[0])).toBe(true);
	expect(regions[0].closest('[role="dialog"]')?.textContent).toContain("Inner");
});

test("closing the dialog doesn't move its announcement to the page, so it isn't read again", async () => {
	await render(DialogHarness);
	await userEvent.click(page.getByRole("button", { name: "Open outer" }));
	announce("once");
	await announced("once");
	await userEvent.keyboard("{Escape}");
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	expect(regionsWith("once")).toHaveLength(0);
	announce("after");
	const regions = await announced("after");
	expect(regions).toHaveLength(1);
	expect(reachable(regions[0])).toBe(true);
});
