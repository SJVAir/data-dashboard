import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildManifest, lightToken, oklchToHex, webManifest } from "./web-manifest.ts";

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
		name: "SJVAir Dashboard",
		shortName: "SJVAir Dashboard",
		themeColor: "#171717",
		backgroundColor: "#ffffff",
		icons: [{ src: "assets/icon-192-abc.png", sizes: "192x192" }]
	}) as Record<string, unknown>;
	it("has the contract fields", () => {
		expect(manifest).toMatchObject({
			name: "SJVAir Dashboard",
			short_name: "SJVAir Dashboard",
			start_url: "/workspace/",
			scope: "/workspace/",
			display: "standalone",
			theme_color: "#171717",
			background_color: "#ffffff",
			icons: [{ src: "assets/icon-192-abc.png", sizes: "192x192", type: "image/png" }]
		});
	});
});

describe("lightToken", () => {
	it("reads from the light :root block even when a dark block comes first", () => {
		const css = `:root[data-theme="dark"] { --primary: oklch(0.9 0 0); }\n:root { --primary: oklch(1 0 0); }`;
		expect(lightToken(css, "--primary")).toBe("#ffffff");
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
			"assets/icon-512-HASH1234.png",
			"assets/maskable-192-HASH1234.png",
			"assets/maskable-512-HASH1234.png"
		]);
		expect(json.icons.map((i: { sizes: string; purpose: string }) => [i.sizes, i.purpose])).toEqual(
			[
				["192x192", "any"],
				["512x512", "any"],
				["192x192", "maskable"],
				["512x512", "maskable"]
			]
		);
		expect(json.name).toBe("SJVAir Dashboard");
		expect(json.theme_color).toBe("#1c4482");
		expect(json.background_color).toBe("#f2f6fa");
	});
});

describe("webManifest dev middleware", () => {
	type Handler = (
		req: { url?: string },
		res: { setHeader: (k: string, v: string) => void; end: (body: unknown) => void },
		next: () => void
	) => void;
	function drive(url: string) {
		let handler!: Handler;
		const plugin = webManifest();
		(plugin.configureServer as (s: unknown) => void)({
			middlewares: { use: (h: Handler) => (handler = h) }
		});
		const headers: Record<string, string> = {};
		let body: unknown;
		const next = vi.fn();
		handler({ url }, { setHeader: (k, v) => (headers[k] = v), end: (b) => (body = b) }, next);
		return { headers, body, next };
	}
	const names = ["icon-192.png", "icon-512.png", "maskable-192.png", "maskable-512.png"];

	it("serves the manifest with all four icons", () => {
		const { headers, body, next } = drive("/workspace/manifest.webmanifest?x=1");
		expect(headers["Content-Type"]).toBe("application/manifest+json");
		const json = JSON.parse(String(body));
		expect(json.icons.map((i: { src: string }) => i.src)).toEqual(names.map((n) => `icons/${n}`));
		expect(next).not.toHaveBeenCalled();
	});
	for (const name of names) {
		it(`serves ${name} as image/png`, () => {
			const { headers, body } = drive(`/workspace/icons/${name}`);
			expect(headers["Content-Type"]).toBe("image/png");
			expect(Buffer.compare(body as Buffer, readFileSync(`static-src/icons/${name}`))).toBe(0);
		});
	}
	it("passes unrelated paths on", () => {
		expect(drive("/workspace/other").next).toHaveBeenCalledOnce();
	});
});
