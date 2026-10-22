import axe from "axe-core";
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../../app.css";
import LevelSwatch from "./LevelSwatch.svelte";

async function renderSwatch() {
	return render(LevelSwatch, { color: "#ffff00", label: "Moderate" });
}

test("LevelSwatch shows the visible label", async () => {
	const screen = await renderSwatch();
	await expect.element(screen.getByText("Moderate")).toBeVisible();
});

test("LevelSwatch chip is outlined and hidden from assistive tech", async () => {
	const { container } = await renderSwatch();
	const chip = container.querySelector("[data-swatch-chip]") as HTMLElement;
	expect(chip).not.toBeNull();
	expect(chip.getAttribute("aria-hidden")).toBe("true");
	expect(parseFloat(getComputedStyle(chip).outlineWidth)).toBeGreaterThan(0);
});

test("LevelSwatch on a white background has no axe violations", async () => {
	const { container } = await renderSwatch();
	document.body.style.background = "#ffffff";
	const results = await axe.run(container);
	expect(results.violations).toEqual([]);
});
