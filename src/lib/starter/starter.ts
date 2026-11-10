import type { DashboardSummary } from "$lib/documents/names";
import { MONTH_CALENDAR_TYPE } from "$lib/calendars/types";
import type { ChosenPlace } from "$lib/data/schema";
import {
	CURRENT_SCHEMA_VERSION,
	DashboardSchema,
	type Dashboard,
	type WidgetInstance
} from "$lib/documents/schema";
import { NOTE_TYPE } from "$lib/notes/options";
import type { Platform, SpaceId } from "$lib/platform/types";
import { DocumentSession, type DocumentSessionOptions } from "$lib/store/document-session.svelte";
import type { TabChannel } from "$lib/store/tab-channel";
import { CHART_TYPE } from "$lib/widgets/chart";
import { CURRENT_TYPE } from "$lib/widgets/current";
import { DEFAULT_LAYER, DEFAULT_RANGE } from "$lib/widgets/defaults";
import { FORECAST_TYPE } from "$lib/widgets/forecast";
import { OUTSIDE_TYPE } from "$lib/widgets/outside";
import { resolveDefaultPlace } from "./resolve";

export const STARTER_ID = "starter";

const STARTER_TIME = "2026-10-20T00:00:00Z";

/** The starter's place in the template, replaced by the chosen place before anyone sees it. */
const DEFAULT_PLACE = { kind: "default-place" } as const;
const PM25 = { ...DEFAULT_LAYER, place: DEFAULT_PLACE };

/**
 * The starter's widgets, in reading order, with each layer's data as Get data stores it for the
 * type (PM2.5; `starter.test.ts` checks they match). Rows of the 12-column grid: the welcome Note;
 * the "now" row, as tall as "Can we go outside?" fits; then the chart and the month calendar.
 */
function starterWidgets(): Omit<WidgetInstance, "id" | "title">[] {
	return [
		{
			type: NOTE_TYPE,
			rect: { x: 0, y: 0, w: 12, h: 2 },
			data: { layers: [] },
			options: { message: "starter_note_welcome" }
		},
		{ type: CURRENT_TYPE, rect: { x: 0, y: 2, w: 3, h: 7 }, data: { layers: [PM25] } },
		{ type: OUTSIDE_TYPE, rect: { x: 3, y: 2, w: 3, h: 7 }, data: { layers: [PM25] } },
		{
			type: FORECAST_TYPE,
			rect: { x: 6, y: 2, w: 6, h: 7 },
			data: { layers: [{ dataset: "forecasts", place: DEFAULT_PLACE }] }
		},
		{
			type: CHART_TYPE,
			rect: { x: 0, y: 9, w: 8, h: 6 },
			data: { dateRange: DEFAULT_RANGE, layers: [PM25] }
		},
		{
			type: MONTH_CALENDAR_TYPE,
			rect: { x: 8, y: 9, w: 4, h: 6 },
			data: { dateRange: { kind: "to-date", unit: "month" }, layers: [PM25] }
		}
	];
}

/**
 * The built-in starter's template: every place is `default-place`, so it passes only
 * `StarterDashboardSchema`. Nothing else holds `default-place`: it's shown, copied, shared and
 * exported as `starterDashboard(place)`.
 */
export function starterTemplate(): Dashboard {
	return {
		kind: "dashboard",
		schemaVersion: CURRENT_SCHEMA_VERSION,
		id: STARTER_ID,
		name: null,
		version: 0,
		createdAt: STARTER_TIME,
		updatedAt: STARTER_TIME,
		body: {
			widgets: structuredClone(starterWidgets()).map((widget, i) => ({
				id: `starter-${i + 1}`,
				title: null,
				...widget
			}))
		}
	};
}

/** The starter at `place` (the space's chosen place), with its "Change place" bar. Never stored. */
export function starterDashboard(place: ChosenPlace): Dashboard {
	const doc = resolveDefaultPlace(starterTemplate(), place);
	doc.body.placeBar = { place: structuredClone(place) };
	return doc;
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

/** The starter at `place`, as a new document of this person's own. */
export function copyOfStarter(now: Date, place: ChosenPlace): Dashboard {
	return freshCopy(starterDashboard(place), now, STARTER_ID);
}

export function blankDashboard(now: Date): Dashboard {
	return freshCopy({ ...starterTemplate(), body: { widgets: [] } }, now);
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
	/** The place the starter shows (the space's chosen place); its copy keeps it. */
	place: ChosenPlace;
	/** Called once the copy is stored, holding the first edit. */
	onCopied?: (copy: DocumentSession) => void;
} & Pick<DocumentSessionOptions, "onNeedsReload" | "onCleared" | "onEdit">;

/**
 * A session showing the starter at `place`. Its first edit stores `copyOfStarter` (validated), applies the edit to
 * the copy's session (so undo reverts the edit but keeps the copy), and hands later edits to
 * that session.
 */
export function starterSession(opts: StarterSessionOptions): DocumentSession {
	const { platform, space, tabId, channel, debounceMs, place, now = () => new Date() } = opts;
	const { onNeedsReload, onCleared, onEdit } = opts;
	// A tab that missed "Clear my data" mustn't store a copy afterwards.
	const generation = platform.reset.generation();
	return new DocumentSession({
		platform,
		space,
		tabId,
		debounceMs,
		now,
		onNeedsReload,
		onCleared,
		doc: starterDashboard(place),
		onBeforeFirstEdit: async (change) => {
			if (platform.reset.generation() !== generation) {
				onCleared?.();
				return null;
			}
			const doc = copyOfStarter(now(), place);
			// Storage doesn't validate: a copy that would hold `default-place` fails here instead.
			const valid = DashboardSchema.safeParse(doc);
			if (!valid.success) throw new Error(`The starter's copy is invalid: ${valid.error.message}`);
			const created = await platform.documents.commit(space, {
				docId: doc.id,
				baseVersion: null,
				doc,
				entries: []
			});
			if (!created.ok) return null;
			channel?.post({ type: "committed", space, docId: doc.id, version: 0, tabId });
			const copy = new DocumentSession({
				platform,
				space,
				tabId,
				channel,
				debounceMs,
				now,
				doc,
				onNeedsReload,
				onCleared,
				onEdit
			});
			copy.apply(change);
			opts.onCopied?.(copy);
			// Not awaited: edits queued on the starter during the hand-off must reach the copy
			// before any edit made on it directly, now that it's current.
			void copy.flush();
			return copy;
		}
	});
}
