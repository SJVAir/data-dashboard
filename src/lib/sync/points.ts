/**
 * Exact locations on a live-shared dashboard. Unless the owner chose "Share my exact location"
 * for its link, a point never reaches the server while the link is on: every upload of the
 * document goes through `pointsHeld` (held until the app swaps the point for its region), and a
 * batch whose changes mention a point is sent as one replacement instead (`mentionsPoint`).
 */
import type { Dashboard } from "$lib/documents/schema";
import { hasPoints } from "$lib/sharing/point-layers";
import type { SyncRecord } from "./types";

/** Whether the document's live link shows regions only (on, and not shared exactly). */
export function guardsPoints(record: SyncRecord): boolean {
	return record.shareToken !== null && !record.shareExact;
}

/**
 * The check every upload of a stored document makes first: true when `doc` holds a point its
 * live link mustn't show, so nothing is sent until the point is swapped.
 */
export function pointsHeld(record: SyncRecord, doc: Dashboard): boolean {
	return guardsPoints(record) && hasPoints(doc);
}

/** Whether a save's changes hold a point anywhere (an undone pick's `from`, say). */
export function mentionsPoint(changes: unknown): boolean {
	return JSON.stringify(changes).includes('"kind":"point"');
}

/** A save refused before sending: the document holds a point its live link mustn't show. */
export class PointsHeld extends Error {
	constructor() {
		super("The dashboard holds an exact location its live link mustn't show");
		this.name = "PointsHeld";
	}
}
