import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "e2e",
	forbidOnly: !!process.env.CI,
	reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
	webServer: {
		command: "npm run build && npx vite preview --port 4173 --strictPort",
		url: "http://localhost:4173/workspace/",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	},
	use: {
		baseURL: "http://localhost:4173/workspace/"
	},
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{ name: "firefox", use: { ...devices["Desktop Firefox"] } },
		{ name: "webkit", use: { ...devices["Desktop Safari"] } }
	]
});
