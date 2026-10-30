import { defineConfig } from "vitest/config";
import { loadEnv, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { enhancedImages } from "@sveltejs/enhanced-img";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { playwright } from "@vitest/browser-playwright";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { canonicalHome } from "./src/lib/routing.ts";
import { buildInfo } from "./vite-plugins/build-info.ts";
import { licenses } from "./vite-plugins/licenses.ts";
import { webManifest } from "./vite-plugins/web-manifest.ts";

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

/**
 * Dev only: serve the app for the bare `/workspace` (Vite would show its base-URL hint page).
 * The middleware is registered directly, so it runs before Vite's own base check.
 */
function bareBase(): Plugin {
	return {
		name: "sjvair-bare-base",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use((req, _res, next) => {
				const url = req.url ?? "";
				const q = url.indexOf("?");
				const home = canonicalHome(q < 0 ? url : url.slice(0, q));
				if (home) req.url = home + (q < 0 ? "" : url.slice(q));
				next();
			});
		}
	};
}

/**
 * The contract CSP from `csp-hosts.json`, for the preview server, so the E2E suite runs under it.
 * The preview serves the static folder from its own origin, so `{static}` adds nothing to 'self'.
 */
function contractCsp(): string {
	const directives: Record<string, string[]> = JSON.parse(
		readFileSync(new URL("./csp-hosts.json", import.meta.url), "utf8")
	);
	return Object.entries(directives)
		.map(([name, sources]) => [name, ...sources.filter((s) => s !== "{static}")].join(" "))
		.join("; ");
}

/**
 * Dev only: same-origin `/api/` and `/account/` go to the local sjvair.com stack (the app's own
 * routes live under `/workspace/`, so nothing clashes). The Host header is kept so Django sees
 * the dev origin and its CSRF origin check passes. Vite loads `.env` for the app, not for this
 * file, so `SJVAIR_DEV_SERVER` is read with `loadEnv`.
 */
function devProxy(mode: string) {
	const target = loadEnv(mode, process.cwd(), "").SJVAIR_DEV_SERVER || "http://localhost:8000";
	return {
		"/api/": { target, changeOrigin: false },
		"/account/": { target, changeOrigin: false }
	};
}

export default defineConfig(({ command, mode, isPreview }) => ({
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
		licenses(),
		webManifest(),
		absoluteShell(),
		bareBase(),
		// `npm run dev:lan`: phones on the local network need HTTPS, because over plain http to an
		// IP address the browser leaves out `crypto.randomUUID` and `crypto.subtle`.
		...(command === "serve" && !isPreview && process.env.DEV_HTTPS ? [basicSsl()] : [])
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
	server: { proxy: devProxy(mode) },
	preview: { headers: { "Content-Security-Policy": contractCsp() } },
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
					include: ["src/**/*.test.ts", "vite-plugins/**/*.test.ts", "scripts/**/*.test.{ts,mjs}"],
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
						instances: [{ browser: "chromium" }],
						commands: {
							/** Emulate `prefers-reduced-motion` for the test page (null resets it). */
							setReducedMotion: async (ctx, reduce: boolean | null) => {
								await ctx.page.emulateMedia({
									reducedMotion: reduce === null ? null : reduce ? "reduce" : "no-preference"
								});
							}
						}
					}
				}
			}
		]
	}
}));
