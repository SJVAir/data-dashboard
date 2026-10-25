import { execSync } from "node:child_process";
import type { Plugin } from "vite";

function gitHead(): string | undefined {
	try {
		return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
			.toString()
			.trim();
	} catch {
		return undefined;
	}
}

/**
 * Stamps the build id into the code (`__BUILD_ID__`) and emits `assets/version.json` beside the
 * entry chunk, so the running app can tell when a newer deploy exists. `"dev"` under `vite dev`.
 */
export function buildInfo(): Plugin {
	let buildId = "dev";
	return {
		name: "sjvair-build-info",
		config(_config, { command }) {
			buildId =
				command === "serve"
					? "dev"
					: process.env.BUILD_ID || process.env.GITHUB_SHA || gitHead() || "unknown";
			return { define: { __BUILD_ID__: JSON.stringify(buildId) } };
		},
		generateBundle() {
			this.emitFile({
				type: "asset",
				fileName: "assets/version.json",
				source: JSON.stringify({ buildId })
			});
		}
	};
}
