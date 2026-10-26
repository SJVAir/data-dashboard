import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import cspHosts from "../csp-hosts.json";

const CONTRACT: Record<string, string[]> = {
	"default-src": ["'none'"],
	"script-src": ["'self'", "{static}"],
	"style-src": ["'self'", "{static}", "'unsafe-inline'"],
	"font-src": ["'self'", "{static}"],
	"img-src": ["'self'", "{static}", "data:", "blob:"],
	"connect-src": ["'self'", "{static}"],
	"worker-src": ["'self'", "blob:"],
	"manifest-src": ["'self'"],
	"frame-ancestors": ["'none'"],
	"base-uri": ["'none'"],
	"object-src": ["'none'"],
	"form-action": ["'none'"]
};

// Hosts that appear in source but are never fetched.
const NOT_FETCHED = new Set([
	// A link the person follows (navigation, not a fetch).
	"www.sjvair.com",
	// Dummy base for parsing a relative URL with `new URL(path, base)`; nothing is requested.
	"x",
	// Dummy base for `new URL(".", base)` when there is no `location`; nothing is requested.
	"localhost"
]);

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			return path === join("src", "lib", "paraglide") ? [] : sourceFiles(path);
		}
		return /\.(ts|svelte|css)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
	});
}

describe("csp-hosts.json", () => {
	it("is exactly the contract's directives and sources, in order", () => {
		expect(Object.entries(cspHosts)).toEqual(Object.entries(CONTRACT));
	});

	it("lists every host the source references, or the host is allowlisted as not fetched", () => {
		const listed = new Set(
			Object.values(cspHosts)
				.flat()
				.flatMap((source) => {
					try {
						return [new URL(source).hostname];
					} catch {
						return [];
					}
				})
		);
		const unlisted: string[] = [];
		for (const file of sourceFiles("src")) {
			const text = readFileSync(file, "utf8");
			for (const match of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
				const host = match[1];
				if (!listed.has(host) && !NOT_FETCHED.has(host)) unlisted.push(`${host} (${file})`);
			}
		}
		expect(unlisted).toEqual([]);
	});
});
