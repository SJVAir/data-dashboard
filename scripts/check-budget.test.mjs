import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { budgetWarnings, initialFiles } from "./check-budget.mjs";

const manifest = {
	"index.html": {
		file: "workspace/app.js",
		isEntry: true,
		imports: ["_shared.js"],
		dynamicImports: ["src/main.ts", "src/sentry.ts"],
		css: ["workspace/boot.css"]
	},
	"src/main.ts": {
		file: "workspace/main.js",
		imports: ["_shared.js", "_ui.js"],
		dynamicImports: ["src/dialog.ts"],
		css: ["workspace/app.css"]
	},
	"_shared.js": { file: "workspace/shared.js" },
	"_ui.js": { file: "workspace/ui.js", imports: ["_shared.js"], css: ["workspace/ui.css"] },
	"src/sentry.ts": { file: "workspace/sentry.js" },
	"src/dialog.ts": { file: "workspace/dialog.js", css: ["workspace/dialog.css"] }
};

describe("initialFiles", () => {
	const files = initialFiles(manifest, "index.html");

	it("includes the entry, the app chunk, static imports, and their css", () => {
		expect([...files].sort()).toEqual([
			"workspace/app.css",
			"workspace/app.js",
			"workspace/boot.css",
			"workspace/main.js",
			"workspace/shared.js",
			"workspace/ui.css",
			"workspace/ui.js"
		]);
	});

	it("throws when the entry no longer imports the app chunk", () => {
		const broken = {
			...manifest,
			"index.html": { ...manifest["index.html"], dynamicImports: ["src/sentry.ts"] }
		};
		expect(() => initialFiles(broken, "index.html")).toThrow(/src\/main\.ts/);
	});

	it("excludes other dynamic imports", () => {
		for (const file of ["sentry.js", "dialog.js", "dialog.css"]) {
			expect(files).not.toContain(`workspace/${file}`);
		}
	});

	it("counts no file twice", () => {
		expect(new Set(files).size).toBe(files.length);
	});
});

describe("budgetWarnings", () => {
	it("is quiet within budget", () => {
		expect(budgetWarnings(200 * 1024)).toEqual([]);
	});

	it("warns over budget, with an Actions annotation in CI", () => {
		expect(budgetWarnings(201 * 1024)).toHaveLength(1);
		const lines = budgetWarnings(201 * 1024, true);
		expect(lines[0]).toMatch(/^::warning /);
		expect(lines).toHaveLength(2);
	});
});

describe("check-budget script", () => {
	it("warns and exits 0 when the bundle is over budget", () => {
		const dir = mkdtempSync(join(tmpdir(), "budget-"));
		mkdirSync(join(dir, "dist/.vite"), { recursive: true });
		const m = {
			"index.html": { file: "app.js", isEntry: true, dynamicImports: ["src/main.ts"] },
			"src/main.ts": { file: "main.js" }
		};
		writeFileSync(join(dir, "dist/.vite/manifest.json"), JSON.stringify(m));
		writeFileSync(join(dir, "dist/app.js"), "x");
		// Random bytes do not compress, so this passes the 200 KB budget.
		const big = Buffer.from(
			Array.from({ length: 300 * 1024 }, () => Math.floor(Math.random() * 256))
		);
		writeFileSync(join(dir, "dist/main.js"), big);
		const result = spawnSync("node", [resolve("scripts/check-budget.mjs")], {
			cwd: dir,
			encoding: "utf8"
		});
		expect(result.status).toBe(0);
		expect(result.stderr).toMatch(/over its budget/);
	});
});
