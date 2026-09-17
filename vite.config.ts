import { defineConfig } from "vitest/config";
import tailwindcss from "@tailwindcss/vite";
import { enhancedImages } from "@sveltejs/enhanced-img";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
	plugins: [tailwindcss(), enhancedImages(), svelte()],
	resolve: {
		alias: [
			{ find: "$lib", replacement: fileURLToPath(new URL("./src/lib", import.meta.url)) },
			// TEMPORARY — points bare `@sjvair/sdk` (data-dashboard's own imports)
			// at the unpublished sibling repo so the multi-region-selector frontend
			// integration can build/test against getRegionsMeta/
			// getRegionSummariesBulk*/within before sdk-js v4.5.0 is actually
			// published. Remove this alias block and bump package.json's
			// @sjvair/sdk to the real published version once that happens — do not
			// merge this to main with the alias still in place.
			//
			// Exact-match (RegExp, not a plain string) so this does NOT also catch
			// @sjvair/monitor-map's own bundled subpath imports (@sjvair/sdk/hms,
			// /account, /monitors, /http) — those should keep resolving through
			// node_modules to whatever real @sjvair/sdk version monitor-map was
			// built against, not get redirected into this raw source tree.
			{
				find: /^@sjvair\/sdk$/,
				replacement: fileURLToPath(new URL("../sdk-js/mod.ts", import.meta.url))
			},
			// sdk-js resolves its own internal bare specifiers ($http, $datetime)
			// via its deno.json "imports" map, which Vite doesn't know about —
			// mirror that same map here so those internal imports resolve too.
			{
				find: /^\$http$/,
				replacement: fileURLToPath(new URL("../sdk-js/lib/http/mod.ts", import.meta.url))
			},
			{
				find: /^\$datetime$/,
				replacement: fileURLToPath(new URL("../sdk-js/lib/datetime/mod.ts", import.meta.url))
			}
		]
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"]
	}
});
