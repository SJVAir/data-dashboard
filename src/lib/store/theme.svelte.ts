import type { DisplayPreferences, ThemeChoice } from "$lib/platform/types";
import { parseDuration } from "$lib/layout/flip";
import { applyTheme } from "$lib/platform/web/theme";

/** On `<html>` while the theme changes, so colors fade over the base motion (`app.css`). */
export const THEME_CHANGING_CLASS = "theme-changing";

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
	let timer: ReturnType<typeof setTimeout> | undefined;

	// Turns color transitions on for one base motion around the switch (0 ms, so none, under
	// reduced motion); they stay off otherwise, so hovers and focus don't lag.
	function apply(next: ThemeChoice) {
		clearTimeout(timer);
		root.classList.add(THEME_CHANGING_CLASS);
		applyTheme(root, next);
		const ms = parseDuration(getComputedStyle(root).getPropertyValue("--motion-duration-base"));
		timer = setTimeout(() => root.classList.remove(THEME_CHANGING_CLASS), ms);
	}

	const stop = display.onThemeChange((next) => {
		choice = next;
		apply(next);
	});
	return {
		get choice() {
			return choice;
		},
		set(next) {
			choice = next;
			display.setTheme(next);
			apply(next);
		},
		destroy() {
			stop();
			clearTimeout(timer);
			root.classList.remove(THEME_CHANGING_CLASS);
		}
	};
}
