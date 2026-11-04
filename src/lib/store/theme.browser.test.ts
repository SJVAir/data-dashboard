import "../../app.css";
import { afterEach, expect, test } from "vitest";
import { commands } from "vitest/browser";
import { createMemoryDisplay } from "$lib/platform/memory";
import { createThemeState, THEME_CHANGING_CLASS } from "./theme.svelte";

const root = document.documentElement;

afterEach(() => {
	root.removeAttribute("data-theme");
	root.classList.remove(THEME_CHANGING_CLASS);
});

test("switching the theme turns color transitions on briefly, then off", async () => {
	const theme = createThemeState(createMemoryDisplay(), root);
	try {
		theme.set("dark");
		expect(root.classList.contains(THEME_CHANGING_CLASS)).toBe(true);
		expect(getComputedStyle(document.body).transitionDuration).not.toBe("0s");
		await expect.poll(() => root.classList.contains(THEME_CHANGING_CLASS)).toBe(false);
	} finally {
		theme.destroy();
	}
});

test("a switch from another tab transitions too", async () => {
	const display = createMemoryDisplay();
	const theme = createThemeState(display, root);
	try {
		display.setTheme("light");
		expect(root.classList.contains(THEME_CHANGING_CLASS)).toBe(true);
		await expect.poll(() => root.classList.contains(THEME_CHANGING_CLASS)).toBe(false);
	} finally {
		theme.destroy();
	}
});

test("reduced motion: the switch doesn't transition", async () => {
	await commands.setReducedMotion(true);
	const theme = createThemeState(createMemoryDisplay(), root);
	try {
		theme.set("dark");
		expect(root.classList.contains(THEME_CHANGING_CLASS)).toBe(true);
		expect(getComputedStyle(document.body).transitionDuration).toBe("0s");
	} finally {
		theme.destroy();
		await commands.setReducedMotion(null);
	}
});
