import type { OnlineSource } from "../types";

/** Browser connectivity: `navigator.onLine` plus the window's online and offline events. */
export function createWebOnline(
	win: Pick<Window, "addEventListener" | "removeEventListener">,
	nav: { onLine: boolean }
): OnlineSource {
	return {
		online: () => nav.onLine,
		onChange(cb) {
			const up = () => cb(true);
			const down = () => cb(false);
			win.addEventListener("online", up);
			win.addEventListener("offline", down);
			return () => {
				win.removeEventListener("online", up);
				win.removeEventListener("offline", down);
			};
		}
	};
}
