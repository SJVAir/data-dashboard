import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { platform, setPlatform } from "$lib/platform";
import { createWebPlatform } from "$lib/platform/web/storage";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";

setPlatform(await createWebPlatform());
const app = await initApp(platform());

mount(App, {
	target: document.getElementById("app")!,
	context: new Map([[APP_CONTEXT_KEY, app]])
});
