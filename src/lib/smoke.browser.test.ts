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
