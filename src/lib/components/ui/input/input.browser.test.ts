import "../../../../app.css";
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import Input from "./input.svelte";

/** A token's color, resolved the same way the browser resolves it in a shadow. */
function tokenColor(token: string): string {
	const probe = document.createElement("span");
	probe.style.color = `var(${token})`;
	document.body.append(probe);
	const color = getComputedStyle(probe).color;
	probe.remove();
	return color;
}

test("a focused invalid input keeps the focus ring's edge", async () => {
	render(Input, { "aria-label": "Name", "aria-invalid": true });
	const input = page.getByRole("textbox", { name: "Name" });
	await userEvent.tab();
	await expect.element(input).toHaveFocus();
	const el = input.element();
	expect(el.matches(":focus-visible")).toBe(true);
	const shadow = getComputedStyle(el).boxShadow;
	expect(shadow).toContain(tokenColor("--ring-edge"));
	expect(shadow).toContain("0px 0px 0px 4px");
});

test("an invalid input shows the destructive ring when not focused", async () => {
	render(Input, { "aria-label": "Name", "aria-invalid": true });
	const el = page.getByRole("textbox", { name: "Name" }).element();
	expect(getComputedStyle(el).boxShadow).toContain("0px 0px 0px 3px");
});
