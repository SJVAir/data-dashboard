import { defineConfig, devices } from "@playwright/test";

// Local-only suites against the running dev server (`npm run dev`) and the sjvair.com podman
// stack. No `webServer`, and not run in CI.
export default defineConfig({
	forbidOnly: !!process.env.CI,
	reporter: "list",
	projects: [
		{
			name: "dev-stack",
			testDir: "e2e-local",
			testMatch: "dev-stack.spec.ts",
			use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5173/workspace/" }
		},
		{
			name: "embedding",
			testDir: "e2e-local",
			testMatch: "embedding.spec.ts",
			use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:8000/workspace/" }
		}
	]
});
