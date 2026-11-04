import "../../../app.css";
import { toast } from "svelte-sonner";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { commands, page, userEvent } from "vitest/browser";
import { announce, ANNOUNCE_GAP_MS } from "$lib/a11y/announcer.svelte";
import DialogHarness from "./test-harness/DialogHarness.svelte";

declare module "vitest/browser" {
	interface BrowserCommands {
		setReducedMotion: (reduce: boolean | null) => Promise<void>;
	}
}

afterEach(async () => {
	toast.dismiss();
	await commands.setReducedMotion(null);
});

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

test("a toast shown while a dialog is open is read from the dialog's region", async () => {
	await render(DialogHarness);
	await userEvent.click(page.getByRole("button", { name: "Open outer" }));
	await expect.element(page.getByRole("dialog", { name: "Outer" })).toBeVisible();
	toast.error("Couldn't sign out.", { description: "Try again." });
	const regions = await announced("Couldn't sign out. Try again.");
	expect(regions).toHaveLength(1);
	expect(reachable(regions[0])).toBe(true);
});

test("with no dialog open, a toast is left to the toaster, so it isn't read twice", async () => {
	await render(DialogHarness);
	toast.info("Saved a copy");
	await expect.element(page.getByText("Saved a copy")).toBeVisible();
	await new Promise((r) => setTimeout(r, ANNOUNCE_GAP_MS * 2));
	expect(regionsWith("Saved a copy")).toHaveLength(0);
});

test("a toast with no dialog open doesn't cancel an announcement made just before it", async () => {
	await render(DialogHarness);
	announce("Dropped Alpha at column 2, row 1.");
	toast("Saved a copy");
	const regions = await announced("Dropped Alpha at column 2, row 1.");
	expect(regions).toHaveLength(1);
	expect(reachable(regions[0])).toBe(true);
});

/** The one region holding `text` once things settle, checked reachable and on the page. */
async function readFromPage(text: string): Promise<void> {
	const regions = await announced(text);
	expect(regions).toHaveLength(1);
	expect(reachable(regions[0])).toBe(true);
	expect(regions[0].closest('[role="dialog"]')).toBeNull();
}

for (const reduce of [false, true]) {
	const motion = reduce ? " (reduced motion)" : "";

	test(`a toast shown just before its dialog closes is read once, from the page${motion}`, async () => {
		await commands.setReducedMotion(reduce);
		await render(DialogHarness);
		await userEvent.click(page.getByRole("button", { name: "Open outer" }));
		await expect.element(page.getByRole("dialog", { name: "Outer" })).toBeVisible();
		toast("Restored the earlier version.");
		await userEvent.keyboard("{Escape}");
		await readFromPage("Restored the earlier version.");
		await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	});

	test(`an announcement made while its dialog closes is read once, from the page${motion}`, async () => {
		await commands.setReducedMotion(reduce);
		await render(DialogHarness);
		await userEvent.click(page.getByRole("button", { name: "Open outer" }));
		await expect.element(page.getByRole("dialog", { name: "Outer" })).toBeVisible();
		await userEvent.keyboard("{Escape}");
		announce("Saved again");
		await readFromPage("Saved again");
	});
}

test("a toast shown just before a dialog opens is read from the dialog", async () => {
	// One handler shows a toast and opens a dialog: the dialog cuts the toaster off before it reads.
	await render(DialogHarness);
	toast("Opened");
	await new Promise((r) => setTimeout(r, ANNOUNCE_GAP_MS / 4));
	(page.getByRole("button", { name: "Open outer" }).element() as HTMLElement).click();
	await expect.element(page.getByRole("dialog", { name: "Outer" })).toBeVisible();
	const regions = await announced("Opened");
	expect(regions).toHaveLength(1);
	expect(reachable(regions[0])).toBe(true);
});
