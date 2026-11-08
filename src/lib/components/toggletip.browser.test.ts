import "../../app.css";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { animationsSettled } from "../../test/animations";
import Toggletip from "./Toggletip.svelte";

const TEXT = "Days without a band had no smoke detected.";

function show() {
	return render(Toggletip, { label: "About smoke", text: TEXT });
}

test("opens with Enter and closes with Escape, focus stays on the button", async () => {
	show();
	const button = page.getByRole("button", { name: "About smoke" });
	(button.element() as HTMLElement).focus();
	await userEvent.keyboard("{Enter}");
	await expect.element(page.getByText(TEXT).first()).toBeVisible();
	expect(document.activeElement).toBe(button.element());
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => page.getByText(TEXT).first().elements().length).toBe(0);
	expect(document.activeElement).toBe(button.element());
});

test("opens on click and closes on outside click", async () => {
	show();
	await page.getByRole("button", { name: "About smoke" }).click();
	await expect.element(page.getByText(TEXT).first()).toBeVisible();
	await userEvent.click(document.body);
	await expect.poll(() => page.getByText(TEXT).first().elements().length).toBe(0);
});

test("its text is announced", async () => {
	show();
	expect(page.getByRole("status").element().textContent).toBe("");
	await page.getByRole("button", { name: "About smoke" }).click();
	const status = page.getByRole("status");
	await expect.element(status).toHaveTextContent(TEXT);
	await animationsSettled(status.element() as HTMLElement);
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => status.element().textContent).toBe("");
});

test("hover opens it, it stays while the pointer is on it, Escape closes it", async () => {
	show();
	const button = page.getByRole("button", { name: "About smoke" });
	await button.hover();
	await expect.element(page.getByText(TEXT).first()).toBeVisible();
	const content = document.querySelector("[data-slot=popover-content]") as HTMLElement;
	await userEvent.hover(content);
	await new Promise((r) => setTimeout(r, 600));
	expect(document.querySelector("[data-slot=popover-content]")).not.toBeNull();
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => document.querySelector("[data-slot=popover-content]")).toBeNull();
});

test("the button is at least 24 px", async () => {
	show();
	const box = (
		page.getByRole("button", { name: "About smoke" }).element() as HTMLElement
	).getBoundingClientRect();
	expect(box.width).toBeGreaterThanOrEqual(24);
	expect(box.height).toBeGreaterThanOrEqual(24);
});
