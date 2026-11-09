import { describe, expect, it } from "vitest";
import { createWebNotifications } from "./notifications";

function fakeNotification(permission: NotificationPermission, asked: NotificationPermission) {
	const shown: Array<{ title: string; options?: NotificationOptions }> = [];
	let requests = 0;
	const ctor = function (title: string, options?: NotificationOptions) {
		shown.push({ title, options });
	} as unknown as typeof Notification;
	Object.defineProperty(ctor, "permission", { get: () => permission });
	(ctor as { requestPermission: () => Promise<NotificationPermission> }).requestPermission =
		async () => {
			requests++;
			permission = asked;
			return asked;
		};
	return { ctor, shown, requests: () => requests };
}

const media = (touchOnly: boolean) => (query: string) => ({
	matches: touchOnly && query === "(hover: none) and (pointer: coarse)"
});

describe("createWebNotifications", () => {
	it("is unsupported without the Notification API, and request does not prompt", async () => {
		const n = createWebNotifications({ matchMedia: media(false) } as never);
		expect(n.permission()).toBe("unsupported");
		expect(await n.request()).toBe("unsupported");
		n.show({ title: "t", body: "b", tag: "x" });
	});

	it("is unsupported on a phone or tablet even when the API exists", async () => {
		const f = fakeNotification("default", "granted");
		const n = createWebNotifications({ Notification: f.ctor, matchMedia: media(true) } as never);
		expect(n.permission()).toBe("unsupported");
		expect(await n.request()).toBe("unsupported");
		expect(f.requests()).toBe(0);
		n.show({ title: "t", body: "b", tag: "x" });
		expect(f.shown).toEqual([]);
	});

	it("reports the browser's permission on a desktop", () => {
		for (const state of ["granted", "denied", "default"] as const) {
			const f = fakeNotification(state, state);
			const n = createWebNotifications({ Notification: f.ctor, matchMedia: media(false) } as never);
			expect(n.permission()).toBe(state);
		}
	});

	it("show is a no-op until granted, then passes title, body and tag", async () => {
		const f = fakeNotification("default", "granted");
		const n = createWebNotifications({ Notification: f.ctor, matchMedia: media(false) } as never);
		n.show({ title: "t", body: "b", tag: "x" });
		expect(f.shown).toEqual([]);
		expect(await n.request()).toBe("granted");
		n.show({ title: "t", body: "b", tag: "x" });
		expect(f.shown).toEqual([{ title: "t", options: { body: "b", tag: "x" } }]);
	});

	it("a denied request stays denied and shows nothing", async () => {
		const f = fakeNotification("default", "denied");
		const n = createWebNotifications({ Notification: f.ctor, matchMedia: media(false) } as never);
		expect(await n.request()).toBe("denied");
		n.show({ title: "t", body: "b", tag: "x" });
		expect(f.shown).toEqual([]);
	});
});
