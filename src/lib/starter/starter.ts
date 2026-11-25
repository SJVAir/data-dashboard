import type { Change } from "$lib/changes/types";
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
import { DEFAULT_LAYER, DEFAULT_PLACE, DEFAULT_RANGE } from "$lib/widgets/defaults";
import { areasOnly } from "$lib/places/replace";
import { FORECAST_TYPE } from "$lib/widgets/forecast";
import {
	HMS_FIRE,
	HMS_SMOKE,
	MAP_TYPE,
	setsNoMonitors,
	tickTypesIfNone
} from "$lib/widgets/map/options";
import { OUTSIDE_TYPE } from "$lib/widgets/outside";
import { resolveDefaultPlace } from "./resolve";

export const STARTER_ID = "starter";

const STARTER_TIME = "2026-10-20T00:00:00Z";

/** The starter's place in the template, replaced by the chosen place before anyone sees it. */
const TEMPLATE_PLACE = { kind: "default-place" } as const;
const PM25 = { place: TEMPLATE_PLACE, layers: [DEFAULT_LAYER] };

/**
 * The starter's widgets, in reading order, with each widget's data as Get data stores it for the
 * type (PM2.5; `starter.test.ts` checks they match). Rows of the 12-column grid: the welcome Note;
 * the "now" row, as tall as "Can we go outside?" fits; the Map; then the chart and the month
 * calendar. The Map's monitor types aren't here: `starterDashboard` ticks the catalog's.
 */
function starterWidgets(): Omit<WidgetInstance, "id" | "title">[] {
	return [
		{
			type: NOTE_TYPE,
			rect: { x: 0, y: 0, w: 12, h: 2 },
			data: { layers: [] },
			options: { message: "starter_note_welcome" }
		},
		{ type: CURRENT_TYPE, rect: { x: 0, y: 2, w: 3, h: 7 }, data: PM25 },
		{ type: OUTSIDE_TYPE, rect: { x: 3, y: 2, w: 3, h: 7 }, data: PM25 },
		{
			type: FORECAST_TYPE,
			rect: { x: 6, y: 2, w: 6, h: 7 },
			data: { place: TEMPLATE_PLACE, layers: [{ dataset: "forecasts" }] }
		},
		{
			type: MAP_TYPE,
			rect: { x: 0, y: 9, w: 12, h: 7 },
			data: {
				place: TEMPLATE_PLACE,
				layers: [
					{ dataset: DEFAULT_LAYER.dataset, entryType: DEFAULT_LAYER.entryType },
					{ dataset: HMS_SMOKE },
					{ dataset: HMS_FIRE }
				]
			}
		},
		{
			type: CHART_TYPE,
			rect: { x: 0, y: 16, w: 8, h: 6 },
			data: { dateRange: DEFAULT_RANGE, ...PM25 }
		},
		{
			type: MONTH_CALENDAR_TYPE,
			rect: { x: 8, y: 16, w: 4, h: 6 },
			data: { dateRange: { kind: "to-date", unit: "month" }, ...PM25 }
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

/**
 * The place a starter's Chart or Table shows (their Where holds areas only, decision 2): the
 * starter's place when it's an area, else `area` (the school's or point's region, looked up when
 * the place was chosen; `starterAreaOf`), else Fresno County.
 */
export function starterAreaFor(place: ChosenPlace, area?: ChosenPlace | null): ChosenPlace {
	return place.kind === "region" ? place : (area ?? DEFAULT_PLACE);
}

/**
 * The starter at `place` (the space's chosen place), with its "Change place" bar; its Chart (and
 * any Table) at `starterAreaFor(place, area)`, and its Map's air-quality layer ticking `types` (the
 * catalog's monitor types; none ticked when empty). Never stored.
 */
export function starterDashboard(
	place: ChosenPlace,
	area: ChosenPlace | null | undefined,
	types: readonly string[]
): Dashboard {
	const doc = resolveDefaultPlace(starterTemplate(), place);
	const forAreas = starterAreaFor(place, area);
	for (const widget of doc.body.widgets) {
		if (areasOnly(widget.type) && widget.data.place) {
			widget.data.place = structuredClone(forAreas);
		}
	}
	if (types.length > 0) {
		for (const widget of doc.body.widgets) {
			if (widget.type !== MAP_TYPE) continue;
			const layer = widget.data.layers.find((l) => l.dataset === DEFAULT_LAYER.dataset);
			if (layer) layer.monitorTypes = [...types];
		}
	}
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
	// A copy shows the place bar again, even when the original's was closed.
	delete copy.body.placeBar?.closed;
	if (copiedFrom === undefined) delete copy.copiedFrom;
	return copy;
}

/** The starter at `place`, as a new document of this person's own. */
export function copyOfStarter(
	now: Date,
	place: ChosenPlace,
	area: ChosenPlace | null | undefined,
	types: readonly string[]
): Dashboard {
	return freshCopy(starterDashboard(place, area, types), now, STARTER_ID);
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
	/** The region its Chart shows when `place` is a school or point (`starterAreaFor`). */
	area?: ChosenPlace | null;
	/** The monitor types the shown starter's Map ticks (the catalog's, loaded when it was built). */
	types: readonly string[];
	/** The catalog's monitor types, awaited by the first edit before it stores the copy. */
	typesReady: () => Promise<readonly string[]>;
	/** Called once the copy is stored, holding the first edit (if one started the hand-off). */
	onCopied?: (copy: DocumentSession) => void;
} & Pick<DocumentSessionOptions, "onNeedsReload" | "onCleared" | "onEdit">;

/**
 * A session showing the starter at `place`. Its first edit, or `handOff()` (sharing it), stores
 * `copyOfStarter` (validated), applies the edit to the copy's session (so undo reverts the edit
 * but keeps the copy), and hands later edits to that session.
 */
export function starterSession(opts: StarterSessionOptions): DocumentSession {
	const { platform, space, tabId, channel, debounceMs, place, now = () => new Date() } = opts;
	const { onNeedsReload, onCleared, onEdit } = opts;
	// A tab that missed "Clear my data" mustn't store a copy afterwards.
	const generation = platform.reset.generation();
	/** The types the copy was built with. */
	let copyTypes: readonly string[] = [];
	return new DocumentSession({
		platform,
		space,
		tabId,
		debounceMs,
		now,
		onNeedsReload,
		onCleared,
		doc: starterDashboard(place, opts.area, opts.types),
		onBeforeFirstEdit: async (change) => {
			if (platform.reset.generation() !== generation) {
				onCleared?.();
				return null;
			}
			const types = await opts.typesReady();
			copyTypes = types;
			if (platform.reset.generation() !== generation) {
				onCleared?.();
				return null;
			}
			const doc = copyOfStarter(now(), place, opts.area, types);
			// Storage doesn't validate: a copy that would hold `default-place` fails here instead.
			// The throw fails the hand-off, so the starter's session shows the save error
			// (`errorKind: "unavailable"`) and its edits stay queued.
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
			if (change) copy.apply(withStarterTypes(change, copy.doc, types));
			opts.onCopied?.(copy);
			// Not awaited: edits queued on the starter during the hand-off must reach the copy
			// before any edit made on it directly, now that it's current.
			void copy.flush();
			return copy;
		},
		adaptHandedOff: (change, copy) => withStarterTypes(change, copy.doc, copyTypes)
	});
}

/**
 * `change` as the starter's copy (`doc`, built with `types`) takes it. A change made from the shown
 * starter while the types loaded carries its Map without them (neither searched monitors nor ticked
 * types): the copy gets that Map with `types` ticked, as its own Map has them. That's a
 * `setWidgetData` on a Map (none set before or after), an `addWidget` of a Map (Duplicate, or a
 * deleted one put back), and a `replaceDocument` whose Map set none before and after. A Map whose
 * monitors or types the person set keeps exactly theirs; any other change is returned as is.
 */
export function withStarterTypes(change: Change, doc: Dashboard, types: readonly string[]): Change {
	if (types.length === 0) return change;
	if (change.op === "setWidgetData") {
		const widget = doc.body.widgets.find((w) => w.id === change.target.widgetId);
		if ((change.type?.to ?? widget?.type) !== MAP_TYPE) return change;
		if (!setsNoMonitors(change.from) || !setsNoMonitors(change.to)) return change;
		const to = structuredClone(change.to);
		tickTypesIfNone(to, types);
		return { ...change, to };
	}
	if (change.op === "addWidget") {
		const { widget } = change;
		if (widget.type !== MAP_TYPE || !setsNoMonitors(widget.data)) return change;
		const filled = structuredClone(widget);
		tickTypesIfNone(filled.data, types);
		return { ...change, widget: filled };
	}
	if (change.op === "replaceDocument") {
		const before = new Map(change.from.body.widgets.map((w) => [w.id, w]));
		const typeless = (w: WidgetInstance | undefined) =>
			w?.type === MAP_TYPE && setsNoMonitors(w.data);
		if (!change.to.body.widgets.some((w) => typeless(w) && typeless(before.get(w.id)))) {
			return change;
		}
		const to = structuredClone(change.to);
		for (const w of to.body.widgets) {
			if (typeless(w) && typeless(before.get(w.id))) tickTypesIfNone(w.data, types);
		}
		return { ...change, to };
	}
	return change;
}
