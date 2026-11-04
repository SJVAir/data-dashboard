import "../../../app.css";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThemeChoice } from "../types";
import { createWebDisplay } from "./display";
import { applyTheme, syncThemeColor, syncThemeColorWhenStyled, watchSystemTheme } from "./theme";

afterEach(() => {
	document.documentElement.removeAttribute("data-theme");
	document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
});

const meta = () => document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

describe("applyTheme", () => {
	it("sets data-theme for light and dark and removes it for system", () => {
		const root = document.documentElement;
		applyTheme(root, "dark");
		expect(root.getAttribute("data-theme")).toBe("dark");
		applyTheme(root, "light");
		expect(root.getAttribute("data-theme")).toBe("light");
		applyTheme(root, "system");
		expect(root.hasAttribute("data-theme")).toBe(false);
	});

	it("keeps the theme-color meta in step", () => {
		applyTheme(document.documentElement, "dark");
		const dark = meta()?.content;
		applyTheme(document.documentElement, "light");
		const light = meta()?.content;
		expect(dark).toBeTruthy();
		expect(light).toBeTruthy();
		expect(dark).not.toBe(light);
	});
});

describe("syncThemeColor", () => {
	it("creates the meta once, then updates it", () => {
		syncThemeColor(document);
		syncThemeColor(document);
		expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
		expect(meta()?.content).toBe(
			getComputedStyle(document.documentElement).getPropertyValue("--background").trim()
		);
	});
});

describe("syncThemeColorWhenStyled", () => {
	it("syncs again on load when the stylesheet wasn't applied yet", async () => {
		// An unstyled document, as when `app.js` runs before `app.css` applies (WebKit).
		const frame = document.createElement("iframe");
		document.body.append(frame);
		try {
			const doc = frame.contentDocument!;
			const frameMeta = () => doc.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
			syncThemeColorWhenStyled(doc);
			expect(frameMeta()).toBeNull();
			const style = doc.createElement("style");
			style.textContent = ":root { --background: rgb(1, 2, 3); }";
			doc.head.append(style);
			frame.contentWindow!.dispatchEvent(new Event("load"));
			expect(frameMeta()?.content).toBe("rgb(1, 2, 3)");
		} finally {
			frame.remove();
		}
	});

	it("syncs at once when the stylesheet is already applied", () => {
		syncThemeColorWhenStyled(document);
		expect(meta()?.content).toBeTruthy();
	});
});

describe("watchSystemTheme", () => {
	function stubMatchMedia() {
		const mql = new EventTarget() as EventTarget & { matches: boolean };
		mql.matches = false;
		const spy = vi.spyOn(window, "matchMedia").mockReturnValue(mql as unknown as MediaQueryList);
		return { mql, spy };
	}

	it("re-syncs the meta on a change and stops when told", () => {
		const { mql, spy } = stubMatchMedia();
		const stop = watchSystemTheme(document);
		expect(spy).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
		expect(meta()).toBeNull();
		mql.dispatchEvent(new Event("change"));
		expect(meta()).not.toBeNull();
		meta()?.remove();
		stop();
		mql.dispatchEvent(new Event("change"));
		expect(meta()).toBeNull();
		spy.mockRestore();
	});
});

describe("web display", () => {
	it("hears the storage event for the theme key only", () => {
		const display = createWebDisplay(window, null);
		const heard: ThemeChoice[] = [];
		const stop = display.onThemeChange((c) => heard.push(c));
		const fire = (key: string, newValue: string | null) =>
			window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
		fire("sjvair-workspace:theme", "dark");
		fire("sjvair-workspace:other", "light");
		fire("sjvair-workspace:theme", null);
		stop();
		fire("sjvair-workspace:theme", "light");
		expect(heard).toEqual(["dark", "system"]);
	});

	it("setTheme writes storage and notifies this tab", () => {
		const data = new Map<string, string>();
		const storage = {
			getItem: (k: string) => data.get(k) ?? null,
			setItem: (k: string, v: string) => void data.set(k, v)
		} as unknown as Storage;
		const display = createWebDisplay(window, storage);
		const heard: ThemeChoice[] = [];
		display.onThemeChange((c) => heard.push(c));
		display.setTheme("light");
		expect(display.theme()).toBe("light");
		expect(heard).toEqual(["light"]);
	});
});
