import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import Home from "../routes/Home.svelte";

test("Home shows the starter when nothing is stored", async () => {
	const app = await initApp(createMemoryPlatform(), { channel: createMemoryTabHub().channel() });
	const screen = await render(Home, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect
		.element(screen.getByRole("heading", { name: "Starter dashboard" }))
		.toBeInTheDocument();
	expect(app.current.isStarter).toBe(true);
	expect(document.title).toBe("Starter dashboard · SJVAir Workspace");
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
