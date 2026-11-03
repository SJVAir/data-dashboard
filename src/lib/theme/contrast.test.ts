import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast, readTokens, resolve } from "./tokens";

const css = readFileSync(new URL("../../app.css", import.meta.url), "utf8");

type Pair = [string, string, number];

const shared: Pair[] = [
	["--foreground", "--background", 4.5],
	["--foreground", "--card", 4.5],
	["--muted-foreground", "--background", 4.5],
	["--muted-foreground", "--card", 4.5],
	["--link", "--card", 4.5],
	["--link", "--background", 4.5],
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
	const pairs: Pair[] = [...shared, ["--ring", "--card", 3], ["--ring", "--background", 3]];

	for (const [fg, bg, min] of pairs) {
		it(`${fg} on ${bg} is at least ${min}:1`, () => {
			expect(c(fg, bg)).toBeGreaterThanOrEqual(min);
		});
	}

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
		["--ring-edge", "--background", 3]
	];

	for (const [fg, bg, min] of pairs) {
		it(`${fg} on ${bg} is at least ${min}:1`, () => {
			expect(c(fg, bg)).toBeGreaterThanOrEqual(min);
		});
	}

	it("sky blue stays a highlight", () => {
		expect(c("--highlight", "--card")).toBeLessThan(3);
	});
});
