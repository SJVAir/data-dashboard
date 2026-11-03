/**
 * A document refused as "id taken" (another account owns the id) becomes a copy with a new id.
 * Nothing is overwritten: the old one is held as `moved` until edits made to it in tabs that
 * hadn't moved yet are carried over, then removed.
 */
import { applyForced } from "$lib/changes/rebase";
import { loadDashboard } from "$lib/documents/load";
import { CURRENT_SCHEMA_VERSION, type Dashboard } from "$lib/documents/schema";
import { docVersion, type LogEntry } from "$lib/platform/types";
import { docLock, type SyncContext } from "./context";
import { currentChanges, postSync, readLocal, type LocalState } from "./local";
import { SYNC_TAB } from "./types";

export function moveToNewId(ctx: SyncContext, docId: string): Promise<string> {
	return ctx.platform.locks.run(docLock(ctx.space, docId), async () => {
		const local = await readLocal(ctx, docId);
		if (typeof local === "string") throw new Error(`Dashboard ${docId} can't be moved`);
		return moveLocked(ctx, local);
	});
}

/** `moveToNewId` for a caller already holding the doc lock. */
export async function moveLocked(ctx: SyncContext, local: LocalState): Promise<string> {
	const { platform, space } = ctx;
	const from = local.doc.id;
	const to = crypto.randomUUID();
	const at = ctx.now().toISOString();
	const copy: Dashboard = {
		...local.doc,
		id: to,
		copiedFrom: from,
		version: 0,
		createdAt: at,
		updatedAt: at
	};
	const created = await platform.documents.commit(space, {
		docId: to,
		baseVersion: null,
		doc: copy,
		entries: []
	});
	if (!created.ok) throw new Error(`Dashboard ${to} already exists`);
	await platform.sync.put(space, {
		...local.record,
		inFlight: null,
		hold: { kind: "moved", to, through: local.doc.version }
	});
	ctx.channel.post({ type: "moved", space, from, to, tabId: ctx.tabId });
	// As this tab's own commit, so its sync worker uploads the copy now, not at the next sweep.
	ctx.channel.post({ type: "committed", space, docId: to, version: 0, tabId: ctx.tabId });
	postSync(ctx, from);
	return to;
}

/** Carries late edits of every moved document over to its copy, then removes it. */
export async function finishMoves(ctx: SyncContext): Promise<void> {
	for (const record of await ctx.platform.sync.list(ctx.space)) {
		if (record.hold?.kind !== "moved") continue;
		await ctx.platform.locks.run(docLock(ctx.space, record.docId), () =>
			finishMoveLocked(ctx, record.docId)
		);
	}
}

/** Finishes the move of `from` (if it's held as moved), for a caller holding its doc lock. */
export async function finishMoveLocked(ctx: SyncContext, from: string): Promise<void> {
	const { platform, space } = ctx;
	const record = await platform.sync.get(space, from);
	if (record?.hold?.kind !== "moved") return;
	const { to, through } = record.hold;
	const raw = await platform.documents.get(space, from);
	const version = docVersion(raw);
	const log = raw === undefined ? [] : await platform.documents.readLog(space, from, through);
	const late = log === "trimmed" ? [] : log.filter((e) => e.version <= version);
	const changes = currentChanges(late.filter((e) => e.tabId !== SYNC_TAB));
	if (changes.length > 0) {
		const target = await platform.documents.get(space, to);
		// The copy is gone (deleted for good): nothing to carry the edits to.
		if (target !== undefined) {
			const loaded = loadDashboard(target);
			// A newer format: try again after a reload.
			if (loaded.status !== "ok") return;
			const base = loaded.doc;
			const { doc, applied } = applyForced(base, changes);
			const next = base.version + applied.length;
			const entries: LogEntry[] = applied.map((change, i) => ({
				docId: to,
				version: base.version + i + 1,
				change,
				tabId: ctx.tabId,
				schemaVersion: CURRENT_SCHEMA_VERSION
			}));
			const result = await platform.documents.commit(space, {
				docId: to,
				baseVersion: base.version,
				doc: { ...doc, version: next, updatedAt: ctx.now().toISOString() },
				entries
			});
			// A tab saved the copy first: the next sweep tries again.
			if (!result.ok) return;
			// So a failure before the removal doesn't carry them over twice.
			await platform.sync.put(space, { ...record, hold: { kind: "moved", to, through: version } });
			if (entries.length > 0) {
				ctx.channel.post({ type: "committed", space, docId: to, version: next, tabId: SYNC_TAB });
			}
		}
	}
	await platform.documents.remove(space, from);
	postSync(ctx, from);
}
