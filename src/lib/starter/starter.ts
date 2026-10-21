import type { DashboardSummary } from "$lib/documents/names";
import { CURRENT_SCHEMA_VERSION, type Dashboard, type Rect } from "$lib/documents/schema";
import type { Platform, SpaceId } from "$lib/platform/types";
import { DocumentSession } from "$lib/store/document-session.svelte";
import type { TabChannel } from "$lib/store/tab-channel";
import { PLACEHOLDER_TYPE } from "$lib/widgets/placeholder";

export const STARTER_ID = "starter";

const STARTER_TIME = "2026-10-20T00:00:00Z";
const STARTER_RECTS: Rect[] = [
	{ x: 0, y: 0, w: 6, h: 4 },
	{ x: 6, y: 0, w: 6, h: 4 },
	{ x: 0, y: 4, w: 12, h: 4 }
];

/** The built-in starter dashboard. Never stored; the first edit saves a copy. */
export function starterDashboard(): Dashboard {
	return {
		kind: "dashboard",
		schemaVersion: CURRENT_SCHEMA_VERSION,
		id: STARTER_ID,
		name: null,
		version: 0,
		createdAt: STARTER_TIME,
		updatedAt: STARTER_TIME,
		body: {
			widgets: STARTER_RECTS.map((rect, i) => ({
				id: `starter-${i + 1}`,
				type: PLACEHOLDER_TYPE,
				title: null,
				rect: { ...rect },
				data: { layers: [] }
			}))
		}
	};
}

/** A new, unstored document: `source`'s content with a new id, version 0, and `now` times. */
function freshCopy(source: Dashboard, now: Date, copiedFrom?: string): Dashboard {
	const time = now.toISOString();
	const copy: Dashboard = {
		...structuredClone(source),
		id: crypto.randomUUID(),
		copiedFrom,
		version: 0,
		createdAt: time,
		updatedAt: time
	};
	delete copy.deletedAt;
	if (copiedFrom === undefined) delete copy.copiedFrom;
	return copy;
}

export function copyOfStarter(now: Date): Dashboard {
	return freshCopy(starterDashboard(), now, STARTER_ID);
}

export function blankDashboard(now: Date): Dashboard {
	return freshCopy({ ...starterDashboard(), body: { widgets: [] } }, now);
}

/** Same name (text or generated) and content; the caller opens the rename dialog. */
export function duplicateDashboard(source: Dashboard, now: Date): Dashboard {
	return freshCopy(source, now, source.id);
}

export type HomeTarget = { kind: "starter" } | { kind: "dashboard"; id: string };

/** What `/workspace/` opens: the last-opened dashboard, else the latest changed, else the starter. */
export function resolveHome(
	summaries: DashboardSummary[],
	lastOpened: string | undefined
): HomeTarget {
	const live = summaries.filter((d) => d.deletedAt === undefined);
	if (lastOpened !== undefined && live.some((d) => d.id === lastOpened)) {
		return { kind: "dashboard", id: lastOpened };
	}
	if (live.length === 0) return { kind: "starter" };
	const latest = live.reduce((a, b) => (Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a));
	return { kind: "dashboard", id: latest.id };
}

export type StarterSessionOptions = {
	platform: Platform;
	space: SpaceId;
	tabId: string;
	/** Given to the copy's session (the starter session itself never saves). */
	channel?: TabChannel;
	debounceMs?: number;
	now?: () => Date;
	/** Called once the copy is stored, holding the first edit. */
	onCopied?: (copy: DocumentSession) => void;
};

/**
 * A session showing the starter. Its first edit stores `copyOfStarter`, applies the edit to
 * the copy's session (so undo reverts the edit but keeps the copy), and hands later edits to
 * that session.
 */
export function starterSession(opts: StarterSessionOptions): DocumentSession {
	const { platform, space, tabId, channel, debounceMs, now = () => new Date() } = opts;
	return new DocumentSession({
		platform,
		space,
		tabId,
		debounceMs,
		now,
		doc: starterDashboard(),
		onBeforeFirstEdit: async (change) => {
			const doc = copyOfStarter(now());
			const created = await platform.documents.commit(space, {
				docId: doc.id,
				baseVersion: null,
				doc,
				entries: []
			});
			if (!created.ok) return null;
			channel?.post({ type: "committed", space, docId: doc.id, version: 0, tabId });
			const copy = new DocumentSession({ platform, space, tabId, channel, debounceMs, now, doc });
			copy.apply(change);
			opts.onCopied?.(copy);
			// Not awaited: edits queued on the starter during the hand-off must reach the copy
			// before any edit made on it directly, now that it's current.
			void copy.flush();
			return copy;
		}
	});
}
