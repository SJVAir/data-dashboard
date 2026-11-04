import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lines of `target="_blank"` elements that don't carry `<ExternalLinkCue` before they close, so a
 * screen reader user isn't told the link opens a new tab.
 */
export function findUncuedNewTabLinks(source: string): number[] {
	const hits: number[] = [];
	const re = /<([a-zA-Z][\w.]*)\b[^>]*\btarget="_blank"/g;
	for (let match = re.exec(source); match; match = re.exec(source)) {
		const close = source.indexOf(`</${match[1]}`, match.index);
		const body = close === -1 ? "" : source.slice(match.index, close);
		if (!body.includes("<ExternalLinkCue")) {
			hits.push(source.slice(0, match.index).split("\n").length);
		}
	}
	return hits;
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
	it("doesn't report a link in the same tab", () => {
		expect(findUncuedNewTabLinks('<a href="x">X</a>')).toEqual([]);
	});
});

describe("new-tab cues", () => {
	it('gives every target="_blank" link in src the new-tab cue', () => {
		const files = walk(join(process.cwd(), "src")).filter((f) => f.endsWith(".svelte"));
		expect(files.length).toBeGreaterThan(20);
		const report = files.flatMap((f) =>
			findUncuedNewTabLinks(readFileSync(f, "utf8")).map(
				(line) => `${relative(process.cwd(), f)}:${line}`
			)
		);
		expect(report).toEqual([]);
	});
});
