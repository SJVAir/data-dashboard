// Checks the initial bundle budget (spec 5a, "What gets built" section 6): the gzip size of the
// bootstrap entry, the app chunk it dynamically imports, and everything they statically import.
// The budget is a soft limit (decided with the user, 2026-11-02): going over prints a warning
// (and a GitHub Actions annotation in CI) but still exits 0. Raised from 200 KB to 250 KB by the user
// on 2026-11-10 so the soft limit stops halting work; the size gets addressed later if needed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET = 250 * 1024;
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

/** The warning lines for a total over budget, or none when it is within budget. */
export function budgetWarnings(total, actions = false) {
	if (total <= BUDGET) return [];
	const message = `Initial bundle is over its budget: ${(total / 1024).toFixed(1)} KB gzip, budget ${BUDGET / 1024} KB. This is a soft limit, so the check still passes.`;
	return actions ? [`::warning title=Bundle budget::${message}`, message] : [message];
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
	for (const line of budgetWarnings(total, process.env.GITHUB_ACTIONS === "true")) {
		console.warn(line);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
