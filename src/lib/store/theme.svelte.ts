import type { DisplayPreferences, ThemeChoice } from "$lib/platform/types";
import { applyTheme } from "$lib/platform/web/theme";

export type ThemeState = {
	readonly choice: ThemeChoice;
	set(choice: ThemeChoice): void;
	/** Stops following other tabs. */
	destroy(): void;
};

/**
 * The theme choice for this device. `set` is the one place that saves (through the platform's
 * display preferences) and applies; changes from other tabs are applied too.
 */
export function createThemeState(
	display: DisplayPreferences,
	root: HTMLElement = document.documentElement
): ThemeState {
	let choice = $state<ThemeChoice>(display.theme());
	const stop = display.onThemeChange((next) => {
		choice = next;
		applyTheme(root, next);
	});
	return {
		get choice() {
			return choice;
		},
		set(next) {
			choice = next;
			display.setTheme(next);
			applyTheme(root, next);
		},
		destroy: stop
	};
}
