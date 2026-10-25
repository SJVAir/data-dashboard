import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { boot } from "$lib/boot";
import { configureSdk } from "$lib/sdk-setup";
import { createWebPlatform } from "$lib/platform/web/storage";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";

const target = document.getElementById("app")!;

configureSdk(import.meta.env, location.origin);

await boot({
	target,
	createPlatform: createWebPlatform,
	async start(platform) {
		const app = await initApp(platform);
		mount(App, { target, context: new Map([[APP_CONTEXT_KEY, app]]) });
	}
});
