import "./app.css";
import { meetsFloor, renderTooOld } from "./lib/browser-floor";

// The build entry (`app.js`). Mounts into the host page's element; the page doesn't pass a path,
// so files are found relative to this module. Keep this file and `browser-floor.ts` in plain
// syntax so browsers below the floor can still parse them and show the notice.
const target = document.getElementById("SJVAirDataDashboard");

if (!target) {
	console.error("SJVAir Workspace: no #SJVAirDataDashboard element to mount into.");
} else if (!meetsFloor(globalThis.CSS)) {
	renderTooOld(target);
} else {
	const staticBase = new URL(".", /* @vite-ignore */ import.meta.url);
	import("./main")
		.then((m) => m.startApp({ target, staticBase }))
		.catch((error) => {
			console.error("SJVAir Workspace failed to start.", error);
		});
}
