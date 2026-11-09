import { expect, test } from "vitest";
import { createMemoryPlatform } from "$lib/platform/memory";
import { NOTIFY_KEY, notifyEnabled, setNotifyEnabled } from "./notify-pref";

test("off by default, stored per dashboard and per space", async () => {
	const p = createMemoryPlatform();
	expect(NOTIFY_KEY).toBe("notifyWhileOpen");
	expect(await notifyEnabled(p, "anonymous", "a")).toBe(false);
	await setNotifyEnabled(p, "anonymous", "a", true);
	expect(await notifyEnabled(p, "anonymous", "a")).toBe(true);
	expect(await notifyEnabled(p, "anonymous", "b")).toBe(false);
	expect(await notifyEnabled(p, "account:1", "a")).toBe(false);
	await setNotifyEnabled(p, "anonymous", "a", false);
	expect(await notifyEnabled(p, "anonymous", "a")).toBe(false);
});

test("a stored true stays true whatever the permission now is", async () => {
	const p = createMemoryPlatform();
	await setNotifyEnabled(p, "anonymous", "a", true);
	p.notifications.script("denied");
	await p.notifications.request();
	expect(await notifyEnabled(p, "anonymous", "a")).toBe(true);
});
