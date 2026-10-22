import { defineConfig } from "vitest/config";
import tailwindcss from "@tailwindcss/vite";
import { enhancedImages } from "@sveltejs/enhanced-img";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { playwright } from "@vitest/browser-playwright";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
	base: "/workspace/",
	plugins: [
		paraglideVitePlugin({ project: "./project.inlang", outdir: "./src/lib/paraglide" }),
		tailwindcss(),
		enhancedImages(),
		svelte()
	],
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
					include: ["src/**/*.test.ts"],
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
});
