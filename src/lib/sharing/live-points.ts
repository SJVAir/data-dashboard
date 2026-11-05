/**
 * The every-edit rule for live links: on a dashboard whose live link is on without "Share my
 * exact location", any of this tab's edits (Undo and Redo included) that leaves an exact location
 * saves its region instead, as a follow-up the edit's undo step goes past (`amend`), with the
 * "saved as" notice. Until then the sync upload holds the document (`pointsHeld`), so the point
 * never reaches the link. Loaded only for a dashboard that has a point.
 */
import { toast } from "svelte-sonner";
import { announce } from "$lib/a11y/announcer.svelte";
import { m } from "$lib/paraglide/messages.js";
import type { AppContext } from "$lib/store/app.svelte";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import { hasPoints } from "./point-layers";
import { pointSwaps, pointsCovered, summarizeSwaps, swapChange, type SwapSummary } from "./points";

/** Lookups that found a point changed meanwhile are run again this many times at most. */
const MAX_ROUNDS = 3;

/** Each dashboard's run in this tab (by session); an edit meanwhile gets its next round. */
const running = new WeakMap<DocumentSession, Promise<void>>();

/**
 * Swaps the points of `session`'s dashboard for their regions when its live link mustn't show
 * them. One run per dashboard at a time; another tab's run waits (a Web Lock), and a dashboard
 * that tab moved on is left to it. A failed lookup shows "Can't look up your area right now."
 * with Retry, and the upload stays held.
 */
export function guardLivePoints(app: AppContext, session: DocumentSession): Promise<void> {
	const target = session.editTarget;
	const current = running.get(target);
	if (current) return current;
	const run = app.platform.locks
		.run(`sjvair-live-points:${app.space}:${target.doc.id}`, () => swapRounds(app, target))
		.finally(() => running.delete(target));
	running.set(target, run);
	return run;
}

async function swapRounds(app: AppContext, target: DocumentSession): Promise<void> {
	const docId = target.doc.id;
	for (let round = 0; round < MAX_ROUNDS; round++) {
		if (target.readOnly || !hasPoints(target.doc)) return;
		// Stored first, so this compares with what's stored; another tab's newer save is theirs.
		await target.flush();
		const stored = (await app.platform.documents.get(app.space, docId)) as
			{ version?: unknown } | undefined;
		if (stored?.version !== target.doc.version || target.hasPending) return;
		// Only what an upload would hold: a point already on the server isn't swapped by opening.
		if (!(await app.sync?.pointsHeld(docId))) return;
		let swaps: Awaited<ReturnType<typeof pointSwaps>>;
		try {
			swaps = await pointSwaps(target.doc);
		} catch {
			lookupFailed(app, target);
			return;
		}
		// A point added or re-picked during the lookup: looked up again.
		if (!pointsCovered(target.doc, swaps)) continue;
		const change = swapChange(target.doc, swaps);
		if (!change) return;
		target.amend(change);
		await target.flush();
		toast.dismiss(failedToast(docId));
		say(await summarize(swaps));
	}
}

async function summarize(swaps: Awaited<ReturnType<typeof pointSwaps>>): Promise<SwapSummary> {
	try {
		return await summarizeSwaps(swaps);
	} catch {
		// The name couldn't be loaded: the region by its code, as `summarizeSwaps` does on a timeout.
		const regions = swaps.flatMap((s) => (s.region ? [s.region.code] : []));
		if (regions.length === 0) return { kind: "removed" };
		return regions.length === swaps.length && new Set(regions).size === 1
			? { kind: "one", region: regions[0] }
			: { kind: "several" };
	}
}

function noticeFor(summary: SwapSummary): string {
	switch (summary.kind) {
		case "one":
			return m.place_picker_saved_as_region({ region: summary.region });
		case "several":
			return m.live_points_saved_as_several();
		case "removed":
			return m.live_points_left_out();
	}
}

function say(summary: SwapSummary): void {
	const text = noticeFor(summary);
	toast(text);
	// The toast's own region is cut off by an open dialog.
	announce(text, { onlyInDialog: true });
}

/** One at a time per dashboard, however many edits or held uploads ask. */
const failedToast = (docId: string) => `live-points-${docId}`;

/** Dashboards (their sessions) waiting for the connection to come back to look up again. */
const waiting = new WeakSet<DocumentSession>();

/** Says so, with Retry, until a lookup works; also tried again when the connection returns. */
function lookupFailed(app: AppContext, session: DocumentSession): void {
	toast.error(m.share_points_failed(), {
		id: failedToast(session.doc.id),
		duration: Infinity,
		action: {
			label: m.share_points_retry(),
			onClick: () => void guardLivePoints(app, session)
		}
	});
	if (waiting.has(session)) return;
	waiting.add(session);
	const stop = app.platform.online.onChange((online) => {
		if (!online) return;
		stop();
		waiting.delete(session);
		void guardLivePoints(app, session);
	});
}
