import { expect } from "vitest";
import { page } from "vitest/browser";
import { animationsSettled } from "./animations";

/**
 * Opens a Get data What section by its name, as a person would; one already open is left alone.
 * Every section starts closed. (The browser-side twin of e2e's `openSection`.)
 */
export async function openSection(name: string | RegExp): Promise<void> {
	const trigger = page.getByRole("button", { name });
	await expect.element(trigger).toBeVisible();
	if (trigger.element().getAttribute("aria-expanded") === "false") {
		await trigger.click();
		await animationsSettled(document.body);
	}
	await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
}

/**
 * Opens the type's options panel (the button beside Show as, e.g. "Chart options"); one already
 * open is left alone. The panel starts closed, and a click outside it closes it.
 */
export async function openTypeOptions(name: string): Promise<void> {
	const trigger = page.getByRole("button", { name, exact: true });
	await expect.element(trigger).toBeVisible();
	// A panel closing (a click elsewhere, such as Add to Home) finishes first.
	await animationsSettled(document.body);
	if (trigger.element().getAttribute("aria-expanded") === "false") await trigger.click();
	await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
	await expect.element(page.getByRole("dialog", { name })).toBeVisible();
}
