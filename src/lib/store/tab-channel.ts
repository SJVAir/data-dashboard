import type { SpaceId } from "$lib/platform/types";

/** Sent after a tab stores a change. Only a notification: the change log is the truth. */
export type TabMessage = {
	type: "committed";
	space: SpaceId;
	docId: string;
	version: number;
	tabId: string;
};

export interface TabChannel {
	post(msg: TabMessage): void;
	subscribe(fn: (msg: TabMessage) => void): () => void;
}

const CHANNEL_NAME = "sjvair-workspace";

const noopChannel: TabChannel = {
	post() {},
	subscribe: () => () => {}
};

function isTabMessage(value: unknown): value is TabMessage {
	const msg = value as Partial<TabMessage> | null;
	return (
		typeof msg === "object" &&
		msg !== null &&
		msg.type === "committed" &&
		typeof msg.space === "string" &&
		typeof msg.docId === "string" &&
		typeof msg.version === "number" &&
		typeof msg.tabId === "string"
	);
}

/** The browser's channel between tabs of this origin; a no-op where it's unavailable. */
export function createTabChannel(): TabChannel {
	if (typeof BroadcastChannel === "undefined") return noopChannel;
	const channel = new BroadcastChannel(CHANNEL_NAME);
	return {
		post: (msg) => channel.postMessage(msg),
		subscribe(fn) {
			const listener = (event: MessageEvent) => {
				if (isTabMessage(event.data)) fn(event.data);
			};
			channel.addEventListener("message", listener);
			return () => channel.removeEventListener("message", listener);
		}
	};
}

/**
 * In-memory channels for tests. Like `BroadcastChannel`, a message reaches every other
 * channel from the same hub (not the sender) asynchronously.
 */
export function createMemoryTabHub(): { channel(): TabChannel } {
	const listeners = new Map<TabChannel, Set<(msg: TabMessage) => void>>();
	return {
		channel() {
			const own = new Set<(msg: TabMessage) => void>();
			const channel: TabChannel = {
				post(msg) {
					for (const [other, fns] of listeners) {
						if (other === channel) continue;
						for (const fn of fns) queueMicrotask(() => fn(structuredClone(msg)));
					}
				},
				subscribe(fn) {
					own.add(fn);
					return () => own.delete(fn);
				}
			};
			listeners.set(channel, own);
			return channel;
		}
	};
}
