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

/** The build id: `BUILD_ID`, then `GITHUB_SHA`, then the git head; a build with none fails. */
export function resolveBuildId(
	command: "serve" | "build",
	env: NodeJS.ProcessEnv,
	head: () => string | undefined
): string {
	if (command === "serve") return "dev";
	const id = env.BUILD_ID || env.GITHUB_SHA || head();
	if (!id) {
		throw new Error(
			"Build id is unknown: set BUILD_ID or GITHUB_SHA, or build inside a git checkout."
		);
	}
	return id;
}

/**
 * Stamps the build id into the code (`__BUILD_ID__`) and emits `workspace/version.json` beside the
 * entry chunk, so the running app can tell when a newer deploy exists. `"dev"` under `vite dev`.
 */
export function buildInfo(): Plugin {
	let buildId = "dev";
	return {
		name: "sjvair-build-info",
		config(_config, { command }) {
			buildId = resolveBuildId(command, process.env, gitHead);
			return { define: { __BUILD_ID__: JSON.stringify(buildId) } };
		},
		generateBundle() {
			this.emitFile({
				type: "asset",
				fileName: "workspace/version.json",
				source: JSON.stringify({ buildId })
			});
		}
	};
}
