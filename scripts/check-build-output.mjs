// Checks dist/workspace/ against the hosting contract (spec 5a, "Files in dist/workspace/").
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "acorn";

const ROOT = "dist/workspace";
const ALLOWED = [
	"app.js",
	"app.css",
	"version.json",
	"manifest.webmanifest",
	"THIRD-PARTY-NOTICES.txt"
];
// Tasks 7 and 9 add THIRD-PARTY-NOTICES.txt and manifest.webmanifest here.
const REQUIRED = ["app.js", "app.css", "version.json"];

function walk(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

const problems = [];
let files = [];
try {
	files = walk(ROOT).map((path) => relative(ROOT, path).split("\\").join("/"));
} catch {
	problems.push(`${ROOT}/ is missing (run the build first)`);
}

for (const name of REQUIRED) {
	if (!files.includes(name)) problems.push(`missing required file: ${name}`);
}
for (const file of files) {
	if (/\.(map|br|gz)$/.test(file)) problems.push(`not allowed (map or compressed): ${file}`);
	if (!file.includes("/")) {
		if (!ALLOWED.includes(file)) problems.push(`unexpected top-level file: ${file}`);
	} else if (!file.startsWith("assets/")) {
		problems.push(`outside assets/: ${file}`);
	} else if (!/-[A-Za-z0-9_-]{8,}\./.test(file)) {
		problems.push(`no content hash in the name: ${file}`);
	}
}

// The bootstrap must stay readable by browsers older than the floor.
if (files.includes("app.js")) {
	try {
		parse(readFileSync(join(ROOT, "app.js"), "utf8"), { ecmaVersion: 2020, sourceType: "module" });
	} catch (error) {
		problems.push(`app.js does not parse as ES2020: ${error.message}`);
	}
}

// Every host named in the built JS/CSS must be listed in csp-hosts.json or be a known non-fetch
// string. Telling fetch URLs apart in minified code isn't practical, so this is deliberately
// broad: a new host shows up here and has to be either listed (a change to sjvair.com's copy
// too) or allowlisted below with a reason.
const NOT_FETCHED = {
	"www.w3.org": "XML/SVG namespace URIs",
	"json-schema.org": "schema identifiers inside zod, not fetched",
	"svelte.dev": "error and warning documentation links in the Svelte runtime",
	"paraglidejs.com": "documentation link in the Paraglide runtime",
	"tailwindcss.com": "license banner comment",
	"docs.sentry.io": "documentation link in @sentry/browser",
	"www.sjvair.com": "a link the person follows (navigation, not a fetch)",
	"example.com": "dummy base for URL parsing in a dependency",
	"fallback.com": "dummy base for URL parsing in a dependency",
	x: "dummy base for URL parsing (src/lib/platform/web/errors.ts)",
	localhost: "dummy base for URL parsing and dev-only checks",
	"192.168.0.163": "private-address example inside a dependency's validation code"
};
const cspListed = new Set(
	Object.values(JSON.parse(readFileSync("csp-hosts.json", "utf8")))
		.flat()
		.flatMap((source) => {
			try {
				return [new URL(source).hostname];
			} catch {
				return [];
			}
		})
);
const hosts = new Set();
for (const file of files.filter((f) => /\.(js|css)$/.test(f))) {
	const text = readFileSync(join(ROOT, file), "utf8");
	for (const match of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) hosts.add(match[1]);
}
for (const host of [...hosts].sort()) {
	const status = cspListed.has(host) ? "listed" : (NOT_FETCHED[host] ?? null);
	console.log(`  host ${host}: ${status ?? "UNKNOWN"}`);
	if (status === null)
		problems.push(`host in built output is neither in csp-hosts.json nor allowlisted: ${host}`);
}

if (problems.length) {
	console.error(`Build output check failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
	process.exit(1);
}
console.log(`Build output OK (${files.length} files in ${ROOT}/).`);
