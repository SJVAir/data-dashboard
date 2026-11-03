import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { saveFields } from "$lib/sync/merge";
import { accountApp } from "$lib/sync/test-app";
import { ACCOUNT, makeDoc } from "$lib/sync/test-support";
import Home from "./Home.svelte";

const originalUrl = location.href;
afterEach(() => {
	history.replaceState(null, "", originalUrl);
});

test("Home shows the starter when nothing is stored", async () => {
	const app = await initApp(createMemoryPlatform(), { channel: createMemoryTabHub().channel() });
	const screen = await render(Home, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect
		.element(screen.getByRole("heading", { name: "Starter dashboard" }))
		.toBeInTheDocument();
	expect(app.current.isStarter).toBe(true);
	expect(document.title).toBe("Starter dashboard · SJVAir Dashboard");
});

test("Home clears the previous dashboard before its target resolves", async () => {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel() });
	const id = await app.index.createBlank();
	app.current = { session: await app.sessions.get(id), isStarter: false };
	// Hold the home resolution (it reads the last-opened preference) open.
	platform.preferences.get = () => new Promise(() => {});
	await render(Home, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	expect(app.current.session).toBeNull();
});

test("Home moves on from an unedited starter when the first dashboards arrive", async () => {
	const { app, fake, worker } = await accountApp([]);
	try {
		await render(Home, { context: new Map([[APP_CONTEXT_KEY, app]]) });
		await expect.poll(() => app.current.isStarter).toBe(true);
		// Saved from another device; this new device's first poll stores it.
		await fake.save("d9", {
			...saveFields({ ...makeDoc("d9"), name: "From the laptop" }),
			baseVersion: null,
			changes: [],
			accountId: ACCOUNT,
			buildId: "other-build",
			snapshot: null
		});
		worker.start();
		await expect.poll(() => location.pathname).toBe("/workspace/dashboards/d9");
	} finally {
		worker.stop();
	}
});
