import { m } from "$lib/paraglide/messages.js";

// Plain syntax on purpose: the bootstrap imports this, and it must parse in browsers below the
// floor. `@property` reached Firefox 128 and Safari 16.4; `color-mix()` reached Chrome 111.
export function meetsFloor(
	css: { supports(p: string, v: string): boolean; registerProperty?: unknown } | undefined
): boolean {
	if (!css || typeof css.registerProperty !== "function") return false;
	return css.supports("color", "color-mix(in lab, red, red)");
}

export function renderTooOld(target: HTMLElement): void {
	const text = document.createElement("p");
	text.textContent = m.browser_too_old();
	const link = document.createElement("a");
	link.href = "https://www.sjvair.com/";
	link.textContent = m.browser_too_old_link();
	target.replaceChildren(text, link);
}

/** Shown when the app's own files fail to load (for example mid-deploy); offers a reload. */
export function renderLoadFailed(target: HTMLElement, reload: () => void): void {
	const text = document.createElement("p");
	text.textContent = m.app_load_failed();
	const button = document.createElement("button");
	button.type = "button";
	button.textContent = m.app_load_failed_reload();
	button.addEventListener("click", reload);
	target.replaceChildren(text, button);
}
