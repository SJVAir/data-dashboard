import { getContrast } from "color2k";
import { oklchToHex } from "../../../vite-plugins/web-manifest";

export type TokenBlock = "light" | "dark-system" | "dark-override";

const SELECTORS: Record<TokenBlock, RegExp> = {
	light: /(?:^|\n):root\s*\{/,
	"dark-system": /:root:not\(\[data-theme="light"\]\)\s*\{/,
	"dark-override": /:root\[data-theme="dark"\]\s*\{/
};

/** Reads the `--name: value` declarations of one token block from the text of `app.css`. */
export function readTokens(css: string, block: TokenBlock): Record<string, string> {
	const start = SELECTORS[block].exec(css);
	if (!start) return {};
	const open = start.index + start[0].length;
	const end = css.indexOf("}", open);
	const body = css.slice(open, end === -1 ? undefined : end).replace(/\/\*[\s\S]*?\*\//g, "");
	const tokens: Record<string, string> = {};
	for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
		tokens[match[1]] = match[2].trim();
	}
	return tokens;
}

/** Follows `var(--x)` references within one token record. */
export function resolve(tokens: Record<string, string>, name: string): string {
	let value = tokens[name];
	for (let i = 0; value !== undefined && i < 8; i++) {
		const ref = /^var\((--[\w-]+)\)$/.exec(value);
		if (!ref) return value;
		value = tokens[ref[1]];
	}
	if (value === undefined) throw new Error(`Token ${name} is not defined`);
	return value;
}

function toHex(color: string): string {
	return color.startsWith("oklch(") ? oklchToHex(color) : color;
}

/** WCAG contrast ratio between two colors, each `oklch(L C H)` or hex. */
export function contrast(a: string, b: string): number {
	return getContrast(toHex(a), toHex(b));
}
