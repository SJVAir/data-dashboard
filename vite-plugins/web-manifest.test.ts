import { describe, expect, it } from "vitest";
import { buildManifest, oklchToHex, webManifest } from "./web-manifest.ts";

describe("oklchToHex", () => {
	const near = (actual: string, expected: string) => {
		for (const i of [1, 3, 5]) {
			const a = parseInt(actual.slice(i, i + 2), 16);
			const e = parseInt(expected.slice(i, i + 2), 16);
			expect(Math.abs(a - e)).toBeLessThanOrEqual(1);
		}
	};
	it("converts white", () => near(oklchToHex("oklch(1 0 0)"), "#ffffff"));
	it("converts the primary grey", () => near(oklchToHex("oklch(0.205 0 0)"), "#171717"));
	it("converts a chromatic color", () => near(oklchToHex("oklch(0.628 0.2577 29.23)"), "#ff0000"));
	it("rejects anything else", () => expect(() => oklchToHex("red")).toThrow(/oklch/));
});

describe("buildManifest", () => {
	const manifest = buildManifest({
		name: "SJVAir Workspace",
		shortName: "SJVAir Workspace",
		themeColor: "#171717",
		backgroundColor: "#ffffff",
		icons: [{ src: "assets/icon-192-abc.png", sizes: "192x192" }]
	}) as Record<string, unknown>;
	it("has the contract fields", () => {
		expect(manifest).toMatchObject({
			name: "SJVAir Workspace",
			short_name: "SJVAir Workspace",
			start_url: "/workspace/",
			scope: "/workspace/",
			display: "standalone",
			theme_color: "#171717",
			background_color: "#ffffff",
			icons: [{ src: "assets/icon-192-abc.png", sizes: "192x192", type: "image/png" }]
		});
	});
});

describe("webManifest plugin", () => {
	it("emits hashed icons and a manifest pointing at them", () => {
		const emitted: Array<{ type: string; name?: string; fileName?: string; source?: unknown }> = [];
		const context = {
			emitFile(file: (typeof emitted)[number]) {
				emitted.push(file);
				return String(emitted.length);
			},
			getFileName: (id: string) =>
				`workspace/assets/${emitted[Number(id) - 1].name!.replace(".png", "-HASH1234.png")}`
		};
		const plugin = webManifest();
		(plugin.generateBundle as () => void).call(context);
		const manifestFile = emitted.find((f) => f.fileName === "workspace/manifest.webmanifest")!;
		const json = JSON.parse(String(manifestFile.source));
		expect(json.icons.map((i: { src: string }) => i.src)).toEqual([
			"assets/icon-192-HASH1234.png",
			"assets/icon-512-HASH1234.png"
		]);
		expect(json.name).toBe("SJVAir Workspace");
		expect(json.theme_color).toBe("#171717");
		expect(json.background_color).toBe("#ffffff");
	});
});
