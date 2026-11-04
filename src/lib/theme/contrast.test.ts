import { readFileSync } from "node:fs";
import { mix } from "color2k";
import { describe, expect, it } from "vitest";
import { oklchToHex } from "../../../vite-plugins/web-manifest";
import { contrast, readTokens, resolve } from "./tokens";

const css = readFileSync(new URL("../../app.css", import.meta.url), "utf8");

type Pair = [string, string, number];

const hex = (color: string) => (color.startsWith("oklch(") ? oklchToHex(color) : color);

/**
 * Destructive text on its own tint (`bg-destructive/N`) over a surface: the card, and a dialog
 * footer (`bg-muted/50` on the card). `alphas` are the tints the button and menu items use in
 * that mode (rest, hover, focus).
 */
function destructiveOnTint(tokens: Record<string, string>, alphas: number[]) {
	const destructive = hex(resolve(tokens, "--destructive"));
	const card = hex(resolve(tokens, "--card"));
	const footer = mix(card, hex(resolve(tokens, "--muted")), 0.5);
	for (const alpha of alphas) {
		for (const [name, surface] of [
			["the card", card],
			["a dialog footer", footer]
		]) {
			it(`--destructive on its ${alpha * 100}% tint over ${name} is at least 4.5:1`, () => {
				expect(contrast(destructive, mix(surface, destructive, alpha))).toBeGreaterThanOrEqual(4.5);
			});
		}
	}
}

const shared: Pair[] = [
	["--foreground", "--background", 4.5],
	["--foreground", "--card", 4.5],
	["--muted-foreground", "--background", 4.5],
	["--muted-foreground", "--card", 4.5],
	// Footers and notice bars are bg-muted.
	["--muted-foreground", "--muted", 4.5],
	["--link", "--card", 4.5],
	["--link", "--background", 4.5],
	// MadeByBar's links sit on bg-muted.
	["--link", "--muted", 4.5],
	// Page titles are navy on the page; headings and outline buttons use it on cards.
	["--primary", "--background", 4.5],
	["--primary", "--card", 4.5],
	// Text-field borders (WCAG 1.4.11); outline buttons keep the lighter --border.
	["--input", "--card", 3],
	["--input", "--background", 3],
	["--primary-foreground", "--primary", 4.5],
	["--highlight-foreground", "--highlight-subtle", 4.5],
	["--destructive", "--card", 4.5],
	["--popover-foreground", "--popover", 4.5],
	["--secondary-foreground", "--secondary", 4.5],
	["--accent-foreground", "--accent", 4.5],
	["--chart-1", "--card", 3],
	["--chart-2", "--card", 3],
	["--chart-3", "--card", 3],
	["--chart-4", "--card", 3],
	["--chart-5", "--card", 3]
];

describe("dark tokens", () => {
	// Dark inherits what it does not override (--ring, --highlight) from :root, as the cascade does.
	const tokens = { ...readTokens(css, "light"), ...readTokens(css, "dark-system") };
	const c = (a: string, b: string) => contrast(resolve(tokens, a), resolve(tokens, b));

	// In dark, --ring-edge equals --background, so the sky ring itself carries the boundary.
	// Menu items draw the ring inset, against the menu and the item's accent fill.
	const pairs: Pair[] = [
		...shared,
		["--ring", "--card", 3],
		["--ring", "--background", 3],
		["--ring", "--popover", 3],
		["--ring", "--accent", 3]
	];

	for (const [fg, bg, min] of pairs) {
		it(`${fg} on ${bg} is at least ${min}:1`, () => {
			expect(c(fg, bg)).toBeGreaterThanOrEqual(min);
		});
	}

	// button.svelte: bg-destructive/10, hover:bg-destructive/15; menu items focus at 15% in dark.
	destructiveOnTint(tokens, [0.1, 0.15]);

	it("both dark blocks are identical", () => {
		expect(readTokens(css, "dark-system")).toEqual(readTokens(css, "dark-override"));
	});

	it("a missing block throws", () => {
		expect(() => readTokens(":root { --a: 1; }", "dark-system")).toThrow(/dark-system/);
	});
});

describe("light tokens", () => {
	const tokens = readTokens(css, "light");
	const c = (a: string, b: string) => contrast(resolve(tokens, a), resolve(tokens, b));

	const pairs: Array<[string, string, number]> = [
		...shared,
		// --ring is sky blue (2.27:1 on white by design); --ring-edge carries the 3:1 boundary.
		["--ring-edge", "--card", 3],
		["--ring-edge", "--background", 3],
		// Menu items draw the ring inset, against the menu and the item's accent fill.
		["--ring-edge", "--popover", 3],
		["--ring-edge", "--accent", 3]
	];

	for (const [fg, bg, min] of pairs) {
		it(`${fg} on ${bg} is at least ${min}:1`, () => {
			expect(c(fg, bg)).toBeGreaterThanOrEqual(min);
		});
	}

	// button.svelte: bg-destructive/10, hover:bg-destructive/15; menu items focus at 10%.
	destructiveOnTint(tokens, [0.1, 0.15]);

	it("sky blue stays a highlight", () => {
		expect(c("--highlight", "--card")).toBeLessThan(3);
	});
});
