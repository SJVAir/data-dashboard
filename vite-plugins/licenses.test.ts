import { describe, expect, it } from "vitest";
import { cssImportedRoots, isAllowedLicense, packageRoot } from "./licenses.ts";

describe("isAllowedLicense", () => {
	it("allows permissive licenses", () => {
		expect(isAllowedLicense({ name: "a", license: "MIT" })).toBe(true);
		expect(isAllowedLicense({ name: "a", license: "ISC" })).toBe(true);
		expect(isAllowedLicense({ name: "a", license: "Apache-2.0" })).toBe(true);
	});
	it("passes an OR expression when any side passes", () => {
		expect(isAllowedLicense({ name: "a", license: "(MIT OR GPL-3.0)" })).toBe(true);
	});
	it("needs every side of an AND expression", () => {
		expect(isAllowedLicense({ name: "a", license: "MIT AND GPL-3.0" })).toBe(false);
		expect(isAllowedLicense({ name: "a", license: "MIT AND ISC" })).toBe(true);
	});
	it("rejects copyleft, unlicensed, and missing licenses", () => {
		expect(isAllowedLicense({ name: "a", license: "GPL-3.0" })).toBe(false);
		expect(isAllowedLicense({ name: "a", license: "UNLICENSED" })).toBe(false);
		expect(isAllowedLicense({ name: "a" })).toBe(false);
	});
	it("allows OFL-1.1 for font packages only", () => {
		expect(isAllowedLicense({ name: "@fontsource-variable/inter", license: "OFL-1.1" })).toBe(true);
		expect(isAllowedLicense({ name: "a", license: "OFL-1.1", keywords: ["fonts"] })).toBe(true);
		expect(isAllowedLicense({ name: "a", license: "OFL-1.1" })).toBe(false);
	});
	it("accepts the named inlang exception with an empty license", () => {
		expect(isAllowedLicense({ name: "@inlang/plugin-message-format", license: "" })).toBe(true);
	});
});

describe("packageRoot", () => {
	it("finds plain, scoped, and nested package roots", () => {
		expect(packageRoot("/p/node_modules/svelte/src/x.js")).toBe("/p/node_modules/svelte");
		expect(packageRoot("/p/node_modules/@a/b/c/d.css?inline")).toBe("/p/node_modules/@a/b");
		expect(packageRoot("/p/node_modules/a/node_modules/b/i.js")).toBe(
			"/p/node_modules/a/node_modules/b"
		);
		expect(packageRoot("/p/src/x.ts")).toBeUndefined();
	});
});

describe("cssImportedRoots", () => {
	it("finds packages imported by a stylesheet, skipping relative imports", () => {
		const roots = [
			...cssImportedRoots(
				'@import "tailwindcss";\n@import "tw-animate-css";\n@import "./local.css";',
				process.cwd()
			)
		];
		expect(roots.map((r) => r.split("/node_modules/")[1]).sort()).toEqual([
			"tailwindcss",
			"tw-animate-css"
		]);
	});
});
