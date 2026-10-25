import type { ClipboardAccess } from "../types";

/** The system clipboard. `writeText` resolves `false` rather than throwing when it's refused. */
export function createWebClipboard(nav: Navigator = navigator): ClipboardAccess {
	return {
		async writeText(text) {
			try {
				if (!nav.clipboard?.writeText) return false;
				await nav.clipboard.writeText(text);
				return true;
			} catch {
				return false;
			}
		}
	};
}
