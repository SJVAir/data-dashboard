import { describe, expect, it } from "vitest";
import { initialFiles } from "./check-budget.mjs";

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

	it("counts no file twice", () => {
		expect(new Set(files).size).toBe(files.length);
	});
});
