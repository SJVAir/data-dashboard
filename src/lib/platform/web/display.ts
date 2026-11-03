import type { DisplayPreferences, ThemeChoice } from "../types";
import { parseThemeChoice, readThemeChoice, THEME_KEY, writeThemeChoice } from "./theme";

/**
 * The per-device theme choice in `localStorage`. `setTheme` saves it and tells this tab's
 * listeners; other tabs hear the browser's `storage` event. It doesn't touch the page itself:
 * whoever listens applies the choice.
 */
export function createWebDisplay(
	win: Pick<Window, "addEventListener" | "removeEventListener">,
	storage: Storage | null
): DisplayPreferences {
	const listeners = new Set<(choice: ThemeChoice) => void>();
	const emit = (choice: ThemeChoice) => {
		for (const cb of [...listeners]) cb(choice);
	};
	const onStorage = (event: Event) => {
		const e = event as StorageEvent;
		if (e.key === THEME_KEY) emit(parseThemeChoice(e.newValue));
	};
	return {
		theme: () => readThemeChoice(storage),
		setTheme(choice) {
			writeThemeChoice(storage, choice);
			emit(choice);
		},
		onThemeChange(cb) {
			if (listeners.size === 0) win.addEventListener("storage", onStorage);
			listeners.add(cb);
			return () => {
				listeners.delete(cb);
				if (listeners.size === 0) win.removeEventListener("storage", onStorage);
			};
		}
	};
}
