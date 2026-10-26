import { mount } from "svelte";
import App from "./App.svelte";
import { boot } from "$lib/boot";
import { ensureDevCsrfCookie } from "$lib/dev/csrf-bootstrap";
import { configureSdk } from "$lib/sdk-setup";
import { createWebPlatform } from "$lib/platform/web/storage";
import { BUILD_ID } from "$lib/safety/build-id";
import { updateNotice } from "$lib/safety/update-notice.svelte";
import { parseBuildId, startVersionCheck } from "$lib/safety/version-check";
import { APP_CONTEXT_KEY, initApp, type AppContext } from "$lib/store/app.svelte";

/** Boots the dashboard into `target`. `staticBase` is the folder holding `app.js`. */
export async function startApp(opts: { target: HTMLElement; staticBase: URL }): Promise<void> {
	const { target, staticBase } = opts;
	// Explicit fields under names without the VITE_ prefix: passing the whole `import.meta.env`
	// would inline every VITE_* value, and the build check fails on any VITE_ name in the output.
	configureSdk(
		{ dev: import.meta.env.DEV, prodUrl: import.meta.env.VITE_PROD_URL },
		location.origin
	);
	// Dev only, so it reads `document.cookie` directly instead of going through the platform adapter.
	await ensureDevCsrfCookie({
		dev: import.meta.env.DEV,
		cookie: document.cookie,
		fetchFn: (input, init) => fetch(input, init)
	});

	// A lazily loaded file from an older deploy is gone: offer a reload instead of an error. The
	// event isn't cancelled, so the failed `import()` still rejects and its caller can stop.
	window.addEventListener("vite:preloadError", () => {
		updateNotice.show("chunk-failed");
	});

	let app: AppContext | undefined;

	await boot({
		target,
		createPlatform: ({ onBlocked }) =>
			createWebPlatform({
				onBlocked,
				onVersionChange() {
					updateNotice.show("storage-upgraded");
					app?.suspendAll();
				}
			}),
		async start(platform) {
			app = await initApp(platform, { staticBase });
			mount(App, { target, context: new Map([[APP_CONTEXT_KEY, app]]) });
			startVersionCheck({
				activity: platform.activity,
				buildId: BUILD_ID,
				notice: updateNotice,
				fetchBuildId: () =>
					fetch(new URL("version.json", staticBase), { cache: "no-store" }).then(parseBuildId)
			});
		}
	});
}
