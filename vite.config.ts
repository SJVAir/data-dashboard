import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { enhancedImages } from "@sveltejs/enhanced-img";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { playwright } from "@vitest/browser-playwright";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, URL } from "node:url";
import { buildInfo } from "./vite-plugins/build-info.ts";

/** The standalone shell (`dist/index.html`) is served for deep routes, so its files need absolute paths. */
function absoluteShell(): Plugin {
	return {
		name: "sjvair-absolute-shell",
		transformIndexHtml: {
			order: "post",
			handler: (html, ctx) =>
				ctx.bundle ? html.replaceAll(/(["'])\.\/workspace\//g, "$1/workspace/") : html
		}
	};
}

export default defineConfig(({ command, isPreview }) => ({
	// Built files find each other by relative reference (see the hosting contract), so one build
	// serves from any origin or folder. The dev server keeps the real mount path; the preview serves
	// `dist/` from the root, so `/workspace/app.js` is `dist/workspace/app.js` and any other path
	// (`/workspace`, `/workspace/dashboards/…`) falls back to `dist/index.html`.
	base: isPreview ? "/" : command === "build" ? "./" : "/workspace/",
	plugins: [
		paraglideVitePlugin({ project: "./project.inlang", outdir: "./src/lib/paraglide" }),
		tailwindcss(),
		enhancedImages(),
		svelte(),
		buildInfo(),
		absoluteShell()
	],
	build: {
		target: ["chrome111", "edge111", "safari16.4", "firefox128"],
		sourcemap: false,
		manifest: true,
		modulePreload: { polyfill: false },
		rollupOptions: {
			input: "index.html",
			output: {
				entryFileNames: "workspace/app.js",
				chunkFileNames: "workspace/assets/[name]-[hash].js",
				// The entry stylesheet is the only CSS Vite names after the HTML entry (`index.css`).
				assetFileNames: (info) =>
					(info.names ?? []).includes("index.css")
						? "workspace/app.css"
						: "workspace/assets/[name]-[hash][extname]"
			}
		}
	},
	optimizeDeps: { include: ["axe-core"] },
	resolve: {
		alias: [{ find: "$lib", replacement: fileURLToPath(new URL("./src/lib", import.meta.url)) }]
	},
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					environment: "node",
					setupFiles: ["src/test/no-network.ts"],
					include: ["src/**/*.test.ts", "vite-plugins/**/*.test.ts"],
					exclude: ["src/**/*.browser.test.ts"]
				}
			},
			{
				extends: true,
				test: {
					name: "browser",
					setupFiles: ["src/test/no-network.ts"],
					include: ["src/**/*.browser.test.ts"],
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						instances: [{ browser: "chromium" }]
					}
				}
			}
		]
	}
}));
