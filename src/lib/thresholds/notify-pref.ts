import type { Platform, SpaceId } from "$lib/platform/types";

/** Preference key (per space and dashboard, as `notifyWhileOpen:<id>`): the notifications switch. */
export const NOTIFY_KEY = "notifyWhileOpen";

const keyFor = (docId: string) => `${NOTIFY_KEY}:${docId}`;

/**
 * Whether this dashboard's notifications switch is on. Off by default. The stored value only:
 * the browser's permission is checked separately when a notification is shown.
 */
export async function notifyEnabled(
	p: Pick<Platform, "preferences">,
	space: SpaceId,
	docId: string
): Promise<boolean> {
	try {
		return (await p.preferences.get(space, keyFor(docId))) === true;
	} catch {
		return false;
	}
}

/** Stores the switch for one dashboard (a preference on this device, never in the document). */
export async function setNotifyEnabled(
	p: Pick<Platform, "preferences">,
	space: SpaceId,
	docId: string,
	on: boolean
): Promise<void> {
	await p.preferences.set(space, keyFor(docId), on);
}
