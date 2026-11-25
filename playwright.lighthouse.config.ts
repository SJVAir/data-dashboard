import { defineConfig } from "@playwright/test";

// The low-end device check (`npm run perf:lighthouse`, after `npm run build`): Lighthouse drives
// its own Chromium, so there's no `webServer` and no browser project here. See
// `e2e/lighthouse/lighthouse.perf.ts`.
export default defineConfig({
	testDir: "e2e/lighthouse",
	testMatch: "lighthouse.perf.ts",
	forbidOnly: !!process.env.CI,
	reporter: "list",
	workers: 1
});
