import type { NotificationAccess, NotifyPermission } from "../types";

type NotificationWindow = {
	Notification?: typeof Notification;
	matchMedia?: (query: string) => { matches: boolean };
};

/** Phones and tablets: no hover and a coarse pointer. Pages can't reliably notify there. */
const TOUCH_ONLY = "(hover: none) and (pointer: coarse)";

/**
 * Desktop notifications through the browser. "unsupported" without the API and on phones and
 * tablets (desktop-only), where it never prompts and never shows.
 */
export function createWebNotifications(
	win: NotificationWindow = window as NotificationWindow
): NotificationAccess {
	const api = () => {
		const ctor = win.Notification;
		if (!ctor || win.matchMedia?.(TOUCH_ONLY).matches) return undefined;
		return ctor;
	};
	const permission = (): NotifyPermission => api()?.permission ?? "unsupported";
	return {
		permission,
		async request() {
			const ctor = api();
			if (!ctor) return "unsupported";
			try {
				return (await ctor.requestPermission()) as NotifyPermission;
			} catch {
				return permission();
			}
		},
		show({ title, body, tag }) {
			const ctor = api();
			if (!ctor || ctor.permission !== "granted") return;
			try {
				new ctor(title, { body, tag });
			} catch {
				// Some browsers refuse the constructor; a missed notification is not an error.
			}
		}
	};
}
