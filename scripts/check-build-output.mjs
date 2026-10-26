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

if (problems.length) {
	console.error(`Build output check failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
	process.exit(1);
}
console.log(`Build output OK (${files.length} files in ${ROOT}/).`);
