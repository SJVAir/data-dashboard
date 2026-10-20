import type { Dashboard } from "$lib/documents/schema";
import { placeAtBottom, rectsOverlap } from "$lib/widgets/placement";
import type { Change } from "./types";
import { applyChange, appliedChange, ChangeTargetMissing } from "./apply";
import { changesOverlap } from "./overlap";

export type RebaseResult =
	| { kind: "clean"; doc: Dashboard; changes: Change[] }
	| { kind: "conflict"; pairs: Array<[mine: Change, theirs: Change]> };

/**
 * Replay `mine` on top of `current`, which already includes `theirs`. Any overlap between the
 * two sides is a conflict (every overlapping pair is returned, for the three-choice prompt);
 * otherwise `mine` is applied with `applyForced`'s rules.
 */
export function rebase(current: Dashboard, theirs: Change[], mine: Change[]): RebaseResult {
	const pairs: Array<[Change, Change]> = [];
	for (const m of mine) {
		for (const t of theirs) if (changesOverlap(m, t)) pairs.push([m, t]);
	}
	if (pairs.length > 0) return { kind: "conflict", pairs };
	const { doc, applied } = applyForced(current, mine);
	return { kind: "clean", doc, changes: applied };
}

/**
 * Apply `changes` in order, dropping any whose target is gone and re-placing an added widget
 * at the bottom (same size) when its rect would overlap one already there. `applied` holds the
 * changes as actually carried out, rewrites included. Used for "Keep mine".
 */
export function applyForced(
	current: Dashboard,
	changes: Change[]
): { doc: Dashboard; applied: Change[] } {
	let doc = current;
	const applied: Change[] = [];
	for (const requested of changes) {
		const change = replaceIfOverlapping(doc, requested);
		try {
			const result = applyChange(doc, change);
			doc = result.doc;
			applied.push(appliedChange(result.inverse));
		} catch (error) {
			if (!(error instanceof ChangeTargetMissing)) throw error;
		}
	}
	return { doc, applied };
}

function replaceIfOverlapping(doc: Dashboard, change: Change): Change {
	if (change.op !== "addWidget") return change;
	const widgets = doc.body.widgets;
	const { rect } = change.widget;
	if (!widgets.some((w) => rectsOverlap(w.rect, rect))) return change;
	const placed = placeAtBottom(widgets, { w: rect.w, h: rect.h });
	return { ...change, widget: { ...change.widget, rect: placed } };
}
