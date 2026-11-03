import type { ThemeChoice } from "../types";

// Plain syntax (no `?.`, no `??`): `bootstrap.ts` imports this before the browser-floor check
// has passed, like `browser-floor.ts`.

export const THEME_KEY = "sjvair-workspace:theme";

/** `localStorage`, or `null` when reaching it throws (blocked storage). */
export function safeLocalStorage(): Storage | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

export function parseThemeChoice(value: string | null): ThemeChoice {
	return value === "light" || value === "dark" ? value : "system";
}

/** The saved choice; anything missing, unknown, or unreadable is `system`. */
export function readThemeChoice(storage: Storage | null): ThemeChoice {
	if (!storage) return "system";
	try {
		return parseThemeChoice(storage.getItem(THEME_KEY));
	} catch {
		return "system";
	}
}

/** Saves the choice; blocked or full storage makes this a no-op. */
export function writeThemeChoice(storage: Storage | null, choice: ThemeChoice): void {
	if (!storage) return;
	try {
		storage.setItem(THEME_KEY, choice);
	} catch {
		// Blocked or full: the choice just won't survive a reload.
	}
}

/** Sets `data-theme` for an override, removes it to follow the system, then syncs the meta. */
export function applyTheme(root: HTMLElement, choice: ThemeChoice): void {
	if (choice === "system") root.removeAttribute("data-theme");
	else root.setAttribute("data-theme", choice);
	syncThemeColor(root.ownerDocument);
}

/** Points `<meta name="theme-color">` (created if absent) at the computed `--background`. */
export function syncThemeColor(doc: Document): void {
	const view = doc.defaultView;
	if (!view) return;
	const color = view.getComputedStyle(doc.documentElement).getPropertyValue("--background").trim();
	if (!color) return;
	let meta = doc.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
	if (!meta) {
		meta = doc.createElement("meta");
		meta.name = "theme-color";
		doc.head.appendChild(meta);
	}
	meta.content = color;
}

/** Re-syncs the meta when the system's color scheme changes; returns a function that stops it. */
export function watchSystemTheme(doc: Document): () => void {
	const view = doc.defaultView;
	if (!view || !view.matchMedia) return function () {};
	const query = view.matchMedia("(prefers-color-scheme: dark)");
	const onChange = function () {
		syncThemeColor(doc);
	};
	query.addEventListener("change", onChange);
	return function () {
		query.removeEventListener("change", onChange);
	};
}
