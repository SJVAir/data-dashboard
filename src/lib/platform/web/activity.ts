import type { ActivitySource } from "../types";

/** Page visibility: visible unless the tab is in the background or the window is minimized. */
export function createWebActivity(page: Document = document): ActivitySource {
	return {
		visible: () => page.visibilityState !== "hidden",
		onChange(cb) {
			const listener = () => cb(page.visibilityState !== "hidden");
			page.addEventListener("visibilitychange", listener);
			return () => page.removeEventListener("visibilitychange", listener);
		}
	};
}
