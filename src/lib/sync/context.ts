import type { Platform, SpaceId } from "$lib/platform/types";
import type { TabChannel } from "$lib/store/tab-channel";
import type { RemoteDocuments } from "./remote";

/** What the sync code works with, for one account space. */
export type SyncContext = {
	platform: Platform;
	space: `account:${string}`;
	/** The space's account (the server's user id); every save names it. */
	accountId: string;
	remote: RemoteDocuments;
	/**
	 * Posts `committed`, `sync`, and `moved`. Open sessions in this tab hear `committed` only
	 * through a channel object of their own (they ignore their own tab's messages, and a channel
	 * never hears itself).
	 */
	channel: TabChannel;
	tabId: string;
	buildId: string;
	now: () => Date;
	/** The server refused this build (the worker's `blocked` is set); the app shows a notice. */
	onBlocked?: () => void;
	/**
	 * `docId` may hold a point its live link mustn't show: an upload was held (`pointsHeld`), or
	 * its link started guarding points (this device learned of it, or it was turned on). The app
	 * swaps any point for its region where the dashboard is open.
	 */
	onPointsHeld?: (docId: string) => void;
};

/** The Web Lock held while a document is uploaded or merged (not re-entrant). */
export const docLock = (space: SpaceId, docId: string) => `sjvair-sync:${space}:${docId}`;
