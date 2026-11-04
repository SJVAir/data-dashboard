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

test("LevelSwatch on a dark card keeps its outline and visible label", async () => {
	document.documentElement.setAttribute("data-theme", "dark");
	const card = document.createElement("div");
	card.className = "bg-card text-card-foreground p-4";
	document.body.appendChild(card);
	try {
		const screen = await render(LevelSwatch, {
			target: card,
			props: { color: "#ffff00", label: "Moderate" }
		});
		const chip = card.querySelector("[data-swatch-chip]") as HTMLElement;
		const style = getComputedStyle(chip);
		expect(style.outlineStyle).toBe("solid");
		expect(parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(1);
		// The outline is the foreground (light on dark), not the card's own color.
		expect(style.outlineColor).toBe(getComputedStyle(card).color);
		expect(style.outlineColor).not.toBe(getComputedStyle(card).backgroundColor);
		await expect.element(screen.getByText("Moderate")).toBeVisible();
		const results = await axe.run(card);
		expect(results.violations).toEqual([]);
	} finally {
		card.remove();
		document.documentElement.removeAttribute("data-theme");
	}
});
