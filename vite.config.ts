import { defineConfig } from "vitest/config";
import tailwindcss from "@tailwindcss/vite";
import { enhancedImages } from "@sveltejs/enhanced-img";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
	plugins: [tailwindcss(), enhancedImages(), svelte()],
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL("./src/lib", import.meta.url))
		}
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"]
	}
});
