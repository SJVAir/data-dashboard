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

/** The visible popover (not the sr-only live region, which holds the same text). */
const content = () => document.querySelector<HTMLElement>("[data-slot=popover-content]");

async function expectOpen() {
	await expect.poll(content).not.toBeNull();
	await expect.element(content()!).toBeVisible();
	await expect.element(content()!).toHaveTextContent(TEXT);
}

test("opens with Enter and closes with Escape, focus stays on the button", async () => {
	show();
	const button = page.getByRole("button", { name: "About smoke" });
	(button.element() as HTMLElement).focus();
	await userEvent.keyboard("{Enter}");
	await expectOpen();
	expect(document.activeElement).toBe(button.element());
	await userEvent.keyboard("{Escape}");
	await expect.poll(content).toBeNull();
	expect(document.activeElement).toBe(button.element());
});

test("opens on click and closes on outside click", async () => {
	show();
	await page.getByRole("button", { name: "About smoke" }).click();
	await expectOpen();
	await userEvent.click(document.body);
	await expect.poll(content).toBeNull();
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
	await expectOpen();
	await userEvent.hover(content()!);
	await new Promise((r) => setTimeout(r, 600));
	expect(content()).not.toBeNull();
	await userEvent.keyboard("{Escape}");
	await expect.poll(content).toBeNull();
});

test("the button is at least 24 px", async () => {
	show();
	const box = (
		page.getByRole("button", { name: "About smoke" }).element() as HTMLElement
	).getBoundingClientRect();
	expect(box.width).toBeGreaterThanOrEqual(24);
	expect(box.height).toBeGreaterThanOrEqual(24);
});
