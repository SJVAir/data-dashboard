// Enforces the initial bundle budget (spec 5a, "What gets built" section 6): the gzip size of the
// bootstrap entry, the app chunk it dynamically imports, and everything they statically import.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET = 200 * 1024;
const ENTRY_KEY = "index.html";
const APP_CHUNK_KEY = "src/main.ts";

/** Files (JS and CSS) loaded before the app is usable, each listed once. */
export function initialFiles(manifest, entryKey) {
	const files = new Set();
	const seen = new Set();
	const visit = (key) => {
		if (seen.has(key)) return;
		seen.add(key);
		const chunk = manifest[key];
		if (!chunk) throw new Error(`Manifest has no entry for ${key}`);
		files.add(chunk.file);
		for (const css of chunk.css ?? []) files.add(css);
		for (const imported of chunk.imports ?? []) visit(imported);
	};
	visit(entryKey);
	if (!manifest[entryKey].dynamicImports?.includes(APP_CHUNK_KEY)) {
		throw new Error(`${entryKey} does not dynamically import ${APP_CHUNK_KEY}`);
	}
	visit(APP_CHUNK_KEY);
	return [...files];
}

function main() {
	const manifest = JSON.parse(readFileSync("dist/.vite/manifest.json", "utf8"));
	const entryKey = ENTRY_KEY;
	if (!manifest[entryKey]?.isEntry) throw new Error(`Manifest has no ${ENTRY_KEY} entry`);
	let total = 0;
	for (const file of initialFiles(manifest, entryKey)) {
		const size = gzipSync(readFileSync(`dist/${file}`), { level: 9 }).length;
		total += size;
		console.log(`${(size / 1024).toFixed(1).padStart(7)} KB  ${file}`);
	}
	console.log(`${(total / 1024).toFixed(1).padStart(7)} KB  total (budget ${BUDGET / 1024} KB)`);
	if (total > BUDGET) {
		console.error("Initial bundle is over budget.");
		process.exit(1);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
