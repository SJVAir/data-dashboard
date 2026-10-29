import { defineConfig, devices } from "@playwright/test";

const PERF = /drag-performance\.spec\.ts$/;

export default defineConfig({
	testDir: "e2e",
	forbidOnly: !!process.env.CI,
	reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
	webServer: {
		command: "npm run build && npx vite preview --port 4173 --strictPort",
		url: "http://localhost:4173/workspace/",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		// Never report from test builds, even when a local .env sets a DSN (shell env beats .env).
		// Test builds are the sjvair.com build, which calls its own origin's API (and the CSP allows
		// only that), so a local .env's VITE_PROD_URL is cleared too.
		env: { VITE_SENTRY_DSN: "", VITE_PROD_URL: "" }
	},
	use: {
		baseURL: "http://localhost:4173/workspace/"
	},
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: PERF },
		// The drag performance check runs alone: after the other Chromium tests, one at a time, so
		// no other test competes for the CPU (CPU throttling is Chromium-only).
		{
			name: "chromium-perf",
			use: { ...devices["Desktop Chrome"] },
			testMatch: PERF,
			dependencies: ["chromium"],
			workers: 1
		},
		{ name: "firefox", use: { ...devices["Desktop Firefox"] }, testIgnore: PERF },
		{ name: "webkit", use: { ...devices["Desktop Safari"] }, testIgnore: PERF }
	]
});
