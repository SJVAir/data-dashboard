import { describe, expect, it } from "vitest";
import { createWebOnline } from "./online";

describe("createWebOnline", () => {
	it("reports navigator.onLine and its changes until stopped", () => {
		const win = new EventTarget();
		const nav = { onLine: true };
		const source = createWebOnline(win, nav);
		const heard: boolean[] = [];
		const stop = source.onChange((v) => heard.push(v));
		expect(source.online()).toBe(true);

		nav.onLine = false;
		win.dispatchEvent(new Event("offline"));
		expect(source.online()).toBe(false);
		nav.onLine = true;
		win.dispatchEvent(new Event("online"));
		stop();
		win.dispatchEvent(new Event("offline"));
		expect(heard).toEqual([false, true]);
	});
});
