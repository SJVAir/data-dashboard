import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";

const ALLOWED = new Set([
	"MIT",
	"BSD-2-Clause",
	"BSD-3-Clause",
	"Apache-2.0",
	"ISC",
	"0BSD",
	"MPL-2.0"
]);
/**
 * Packages with an empty npm `license` field that are MIT anyway: the inlang plugin (its LICENSE
 * file is MIT) and our own SDK (MIT in its repository; the JSR build omits the field).
 */
const NAMED_EXCEPTIONS = new Set(["@inlang/plugin-message-format", "@jsr/sjvair__sdk"]);

export type LicensePackage = {
	name: string;
	license?: string;
	isFont?: boolean;
	keywords?: string[];
};

function isFontPackage(pkg: LicensePackage): boolean {
	return (
		pkg.isFont === true ||
		pkg.name.startsWith("@fontsource/") ||
		pkg.name.startsWith("@fontsource-variable/") ||
		(pkg.keywords ?? []).includes("fonts")
	);
}

/** Evaluates an SPDX expression: `OR` passes when any side does, `AND` needs every side. */
function evaluate(expression: string, allowed: (id: string) => boolean): boolean {
	const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
	let at = 0;
	function atom(): boolean {
		const token = tokens[at++];
		if (token === "(") {
			const value = or();
			at++; // ")"
			return value;
		}
		return token !== undefined && allowed(token.replace(/\+$/, ""));
	}
	function and(): boolean {
		let value = atom();
		while (tokens[at] === "AND") {
			at++;
			value = atom() && value;
		}
		return value;
	}
	function or(): boolean {
		let value = and();
		while (tokens[at] === "OR") {
			at++;
			value = and() || value;
		}
		return value;
	}
	return or();
}

/** Whether a bundled package's license is on the allow list (see the global constraints). */
export function isAllowedLicense(pkg: LicensePackage): boolean {
	if (NAMED_EXCEPTIONS.has(pkg.name)) return true;
	if (!pkg.license) return false;
	return evaluate(pkg.license, (id) => ALLOWED.has(id) || (id === "OFL-1.1" && isFontPackage(pkg)));
}

type Found = { name: string; version: string; license: string; text: string };

/** The package directory a `node_modules` file belongs to, or undefined for project files. */
export function packageRoot(id: string): string | undefined {
	const path = id.split("?")[0].replaceAll("\\", "/");
	const marker = "/node_modules/";
	const start = path.lastIndexOf(marker);
	if (start === -1) {
		// A path relative to the project root, as asset `originalFileNames` are.
		return path.startsWith("node_modules/") ? packageRoot("/" + path)?.slice(1) : undefined;
	}
	const parts = path.slice(start + marker.length).split("/");
	const length = parts[0].startsWith("@") ? 2 : 1;
	return path.slice(0, start + marker.length) + parts.slice(0, length).join("/");
}

function licenseText(root: string): string {
	const file = readdirSync(root).find((name) => /^(licen[cs]e|copying)(\.|$)/i.test(name));
	return file ? readFileSync(join(root, file), "utf8").trim() : "";
}

function describe(rootPath: string): { found: Found; allowed: boolean } {
	const root = resolve(rootPath);
	const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	let license = typeof pkg.license === "string" ? pkg.license : "";
	const text = licenseText(root);
	// An empty field with the standard MIT grant in the LICENSE file (or a named exception) is MIT.
	if (
		!license &&
		(NAMED_EXCEPTIONS.has(pkg.name) || /Permission is hereby granted, free of charge/.test(text))
	) {
		license = "MIT";
	}
	const found = { name: pkg.name, version: pkg.version, license, text };
	return { found, allowed: isAllowedLicense({ name: pkg.name, license, keywords: pkg.keywords }) };
}

export function formatNotices(packages: Found[]): string {
	const rule = "-".repeat(72);
	const entries = packages.map(
		(p) =>
			`${rule}\n${p.name} ${p.version}\nLicense: ${p.license || "see text"}\n\n${p.text || "(no license text shipped with the package)"}\n`
	);
	return `Third-party notices\n\nThis build bundles the following packages.\n\n${entries.join("\n")}`;
}

/**
 * Collects every `node_modules` package with code or CSS in the build, fails the build on a
 * disallowed license, and emits `workspace/THIRD-PARTY-NOTICES.txt` with each license text.
 */
export function licenses(): Plugin {
	return {
		name: "sjvair-licenses",
		apply: "build",
		generateBundle(_options, bundle) {
			// Packages with a module in a chunk, or an asset (fonts pulled in by CSS) in the output.
			const used = new Set<string>();
			for (const item of Object.values(bundle)) {
				const ids =
					item.type === "chunk" ? Object.keys(item.modules ?? {}) : (item.originalFileNames ?? []);
				for (const id of ids) {
					const root = packageRoot(id);
					if (root) used.add(root);
				}
			}
			const found = new Map<string, Found>();
			const rejected: string[] = [];
			for (const root of used) {
				const { found: entry, allowed } = describe(root);
				if (!allowed) rejected.push(`${entry.name}@${entry.version} (${entry.license || "none"})`);
				found.set(`${entry.name}@${entry.version}`, entry);
			}
			if (rejected.length) {
				this.error(`Disallowed licenses in the bundle: ${rejected.join(", ")}`);
			}
			this.emitFile({
				type: "asset",
				fileName: "workspace/THIRD-PARTY-NOTICES.txt",
				source: formatNotices([...found.values()].sort((a, b) => a.name.localeCompare(b.name)))
			});
		}
	};
}
