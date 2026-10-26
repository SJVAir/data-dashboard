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

	it("includes the entry, the app chunk, and static imports", () => {
		expect(files).toEqual(
			expect.arrayContaining([
				"workspace/app.js",
				"workspace/main.js",
				"workspace/shared.js",
				"workspace/ui.js"
			])
		);
	});

	it("excludes other dynamic imports", () => {
		expect(files).not.toContain("workspace/sentry.js");
		expect(files).not.toContain("workspace/dialog.js");
		expect(files).not.toContain("workspace/dialog.css");
	});

	it("includes css of included chunks", () => {
		expect(files).toEqual(
			expect.arrayContaining(["workspace/boot.css", "workspace/app.css", "workspace/ui.css"])
		);
	});

	it("counts no file twice", () => {
		expect(new Set(files).size).toBe(files.length);
	});
});
