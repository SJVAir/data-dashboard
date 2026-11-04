import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const PALETTE = new RegExp(
	"\\b(?:bg|text|border|ring|fill|stroke|outline|from|to|via|shadow|divide)-(?:black|white|" +
		"(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|" +
		"blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3})\\b"
);
const HEX = /#[0-9a-fA-F]{3,8}\b/;
/** Type sizes off the scale (xs, sm, base, lg, 3xl, and field are the tokens). */
const OFF_SCALE = /(?:^|[\s"'`:])text-(?:xl|2xl|[4-9]xl)\b/;
const COLOR_CONTEXT = /\bclass(?:Name)?\s*=|\bstyle\s*=|\bclass:|\bstyle:/;

/** Lines that use a raw palette class, an off-scale type size, or a hex color in a class/style context. */
export function findTokenViolations(source: string): { line: number; text: string }[] {
	const hits: { line: number; text: string }[] = [];
	source.split("\n").forEach((text, i) => {
		if (
			PALETTE.test(text) ||
			OFF_SCALE.test(text) ||
			(HEX.test(text) && COLOR_CONTEXT.test(text))
		) {
			hits.push({ line: i + 1, text: text.trim() });
		}
	});
	return hits;
}

const SRC = join(process.cwd(), "src");
const EXCLUDED = [
	join("src", "lib", "color.ts"),
	join("src", "lib", "theme") + sep,
	join("src", "lib", "paraglide") + sep
];

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		return e.isDirectory() ? walk(p) : [p];
	});
}

function scannedFiles(): string[] {
	return walk(SRC).filter((f) => {
		const rel = relative(process.cwd(), f);
		return (
			/\.(svelte|ts)$/.test(rel) &&
			!rel.endsWith(".test.ts") &&
			!EXCLUDED.some((x) => rel === x || rel.startsWith(x))
		);
	});
}

describe("findTokenViolations", () => {
	it("reports a raw palette class and an inline hex color", () => {
		const src = '<div class="bg-gray-500 p-2">\n<p>ok</p>\n<span style="color:#ff0000">x</span>';
		expect(findTokenViolations(src).map((h) => h.line)).toEqual([1, 3]);
	});
	it("reports a type size off the scale", () => {
		const src =
			'<h1 class="text-xl font-semibold">\n<p class="md:text-2xl">\n<b class="text-lg text-3xl">';
		expect(findTokenViolations(src).map((h) => h.line)).toEqual([1, 2]);
	});
	it("allows token-based classes and arbitrary values that reference tokens", () => {
		const src = [
			'<a class="shadow-[inset_0_-2px_var(--color-highlight)] min-w-[96px] bg-background">',
			'<b class="text-foreground bg-card">'
		].join("\n");
		expect(findTokenViolations(src).map((h) => h.line)).toEqual([]);
	});
});

describe("token discipline", () => {
	it("uses theme tokens, not raw palette classes, off-scale type sizes, or hex colors", () => {
		const files = scannedFiles();
		expect(files.length).toBeGreaterThan(20);
		const report = files.flatMap((f) =>
			findTokenViolations(readFileSync(f, "utf8")).map(
				(h) => `${relative(process.cwd(), f)}:${h.line}  ${h.text}`
			)
		);
		expect(report, `Use theme tokens instead:\n${report.join("\n")}`).toEqual([]);
	});
});
