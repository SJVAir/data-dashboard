import "./app.css";
import { meetsFloor, renderLoadFailed, renderTooOld } from "./lib/browser-floor";
import { refreshEntryFiles, reloadPage } from "./lib/safety/reload";

// The build entry (`app.js`). Mounts into the host page's element; the page doesn't pass a path,
// so files are found relative to this module. Keep this file and `browser-floor.ts` in plain
// syntax so browsers below the floor can still parse them and show the notice.
const target = document.getElementById("SJVAirDataDashboard");

if (!target) {
	console.error("SJVAir Dashboard: no #SJVAirDataDashboard element to mount into.");
} else if (!meetsFloor(globalThis.CSS)) {
	renderTooOld(target);
} else {
	const staticBase = new URL(".", /* @vite-ignore */ import.meta.url);
	import("./main")
		.then((m) => m.startApp({ target, staticBase }))
		.catch((error) => {
			console.error("SJVAir Dashboard failed to start.", error);
			// A missing chunk (say, mid-deploy) fails here, before main.ts's preload-error
			// listener exists; without this the page stays blank. The reload first refreshes the
			// fixed-name entry files, so it doesn't reuse a stale cached `app.js`.
			renderLoadFailed(target, () => {
				refreshEntryFiles(staticBase).then(reloadPage);
			});
		});
}
