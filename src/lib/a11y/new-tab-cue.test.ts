import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/** `target="_blank"`, `target='_blank'`, or `target={"_blank"}`, with any spacing. */
const NEW_TAB = /\btarget\s*=\s*\{?\s*["'`]_blank["'`]/g;
/** A string "_blank" in script (a `.ts` file can't carry the cue, so it shouldn't open tabs). */
const BLANK_STRING = /["'`]_blank["'`]/g;

function lineOf(source: string, index: number): number {
	return source.slice(0, index).split("\n").length;
}

/**
 * Lines of new-tab elements in a `.svelte` file that don't carry `<ExternalLinkCue` before they
 * close, so a screen reader user isn't told the link opens a new tab. The element is the nearest
 * `<Tag` before the attribute, so a `=>` or `>` inside another attribute doesn't throw it off.
 */
export function findUncuedNewTabLinks(source: string): number[] {
	const hits: number[] = [];
	for (const match of source.matchAll(NEW_TAB)) {
		const before = source.slice(0, match.index);
		const tags = [...before.matchAll(/<([a-zA-Z][\w.]*)\b/g)];
		const tag = tags.at(-1);
		const close = tag ? source.indexOf(`</${tag[1]}`, match.index) : -1;
		const body = close === -1 ? "" : source.slice(match.index, close);
		if (!body.includes("<ExternalLinkCue")) hits.push(lineOf(source, match.index));
	}
	return hits;
}

/** Lines of a `.ts` file that use "_blank": a link opened from script, with no place for the cue. */
export function findScriptNewTabs(source: string): number[] {
	return [...source.matchAll(BLANK_STRING)].map((m) => lineOf(source, m.index));
}

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		return e.isDirectory() ? walk(p) : [p];
	});
}

describe("findUncuedNewTabLinks", () => {
	it("reports a new-tab link without the cue, multi-line or not", () => {
		const src = [
			'<a href="x" target="_blank" rel="noopener">X</a>',
			"<a",
			'\thref="y"',
			'\ttarget="_blank">Y<ExternalLinkCue /></a>'
		].join("\n");
		expect(findUncuedNewTabLinks(src)).toEqual([1]);
	});
	it("matches single quotes, an expression, and spacing", () => {
		const src = [
			"<a href=\"x\" target='_blank'>X</a>",
			'<a href="y" target={"_blank"}>Y</a>',
			'<a href="z" target = { "_blank" }>Z<ExternalLinkCue /></a>'
		].join("\n");
		expect(findUncuedNewTabLinks(src)).toEqual([1, 2]);
	});
	it("isn't thrown off by `=>` or `>` in an earlier attribute", () => {
		const src = [
			'<a onclick={() => go(a > b)} href="x" target="_blank">X</a>',
			'<a onclick={() => go()} href="y" target="_blank">Y<ExternalLinkCue /></a>'
		].join("\n");
		expect(findUncuedNewTabLinks(src)).toEqual([1]);
	});
	it("doesn't report a link in the same tab", () => {
		expect(findUncuedNewTabLinks('<a href="x">X</a>')).toEqual([]);
	});
});

describe("findScriptNewTabs", () => {
	it('reports "_blank" in script, in any quotes', () => {
		const src = ['window.open(url, "_blank");', "a.target = '_blank';", "const blank = 1;"].join(
			"\n"
		);
		expect(findScriptNewTabs(src)).toEqual([1, 2]);
	});
});

describe("new-tab cues", () => {
	const files = walk(join(process.cwd(), "src"));
	it('gives every target="_blank" link in a component the new-tab cue', () => {
		const svelte = files.filter((f) => f.endsWith(".svelte"));
		expect(svelte.length).toBeGreaterThan(20);
		const report = svelte.flatMap((f) =>
			findUncuedNewTabLinks(readFileSync(f, "utf8")).map(
				(line) => `${relative(process.cwd(), f)}:${line}`
			)
		);
		expect(report).toEqual([]);
	});
	it("opens no new tab from script, where the cue can't go", () => {
		const scripts = files.filter(
			(f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes("paraglide")
		);
		const report = scripts.flatMap((f) =>
			findScriptNewTabs(readFileSync(f, "utf8")).map(
				(line) => `${relative(process.cwd(), f)}:${line}`
			)
		);
		expect(report).toEqual([]);
	});
});
