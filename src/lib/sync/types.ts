/** Log entries the sync worker writes for changes that came from the server. */
export const SYNC_TAB = "sync";

/** Why a document isn't syncing; codes only, never text. */
export type SyncHold =
	| { kind: "conflict"; serverVersion: number; reason: "overlap" | "log-gap" }
	| { kind: "deleted-elsewhere"; serverVersion: number }
	| { kind: "gone" }
	| { kind: "newer"; schemaVersion: number }
	| { kind: "moved"; to: string; through: number }
	| { kind: "refused"; code: "too_large" | "limit_documents" | "limit_storage" | "invalid" };

/** Where a document stands with the server. */
export type SyncRecord = {
	docId: string;
	/** `null`: never uploaded. */
	serverVersion: number | null;
	/** The local version included in `serverVersion` (0 when never). */
	syncedThrough: number;
	/** When the server last accepted a save or pull. */
	confirmedAt: string | null;
	/** The batch sent and not yet answered; `changes` is its JSON, for the lost-answer check. */
	inFlight: { baseVersion: number | null; throughVersion: number; changes: string } | null;
	hold: SyncHold | null;
	/**
	 * The share link's token while the server shares it, else `null`. Sharing isn't an edit:
	 * records built from a server document take it from there, every other write keeps it, and
	 * a copy (a new id) starts without one.
	 */
	shareToken: string | null;
	/**
	 * The owner chose "Share my exact location" for this link: its exact locations upload as
	 * they are. Only with a token, and only for the token it was chosen with (`withShareToken`);
	 * otherwise a live-shared dashboard's points never upload (`pointsHeld`).
	 */
	shareExact: boolean;
};
