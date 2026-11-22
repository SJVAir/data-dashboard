/**
 * "Show in a chart" / "Show in a table" from a Map (lazy, in the Map's chunk): the Data Portal's
 * starting draft for what the Map sends (its sent marks, or one pesticide section), and where to
 * open it. The draft travels in history state (`{ getData: HandOff }`), never in the URL.
 */
import { getMetadata } from "$lib/data";
import type { CatalogEntry } from "$lib/data/metadata";
import type { Layer, PlaceRef, SpatialSelection } from "$lib/data/schema";
import { fromMapDraft, mapPesticideFilters } from "$lib/get-data/map";
import type { NowConversion } from "$lib/get-data/now";
import type { Draft } from "$lib/get-data/draft.svelte";
import { toWhere } from "$lib/places/selection";
import { STARTER_ID } from "$lib/starter/starter";
import type { AppContext } from "$lib/store/app.svelte";
import { CHART_TYPE, chartType } from "$lib/widgets/chart";
import type { WidgetType } from "$lib/widgets/registry";
import { dataTableType } from "$lib/widgets/table";
import { DEFAULT_RANGE } from "$lib/widgets/defaults";
import { navigate } from "../../../router";
import { HAND_OFF_DROPPED, type HandOff, type HandOffNotes } from "./hand-off";
import { PESTICIDE_USE, mapOptions, useFigureOf } from "./options";
import { mapSend } from "./send-registry";

/** What a Map sends: its sent marks (in mark order), or one pinned section card. */
export type MapSend =
	{ kind: "monitors"; ids: string[]; leftOut: number } | { kind: "section"; code: string };
// spec 7 adds a kind here and a case in sendPlaces; nothing else changes.

/** The Where for a send (the plug-in point). Never a `point`. */
export function sendPlaces(send: MapSend): { place?: PlaceRef; selection?: SpatialSelection } {
	switch (send.kind) {
		case "monitors":
			return toWhere(send.ids.map((id) => ({ kind: "monitor" as const, id })));
		case "section":
			return { place: { kind: "region", type: "mtrs", code: send.code } };
	}
}

export { HandOffSchema, type HandOff, type HandOffNotes } from "./hand-off";

export type ShowInTarget = { path: "/dashboards/:id/widgets/new"; id: string } | { path: "/data" };

/**
 * Where to open (D2, D11): the current dashboard's new widget when it holds `widgetId` and is
 * editable (the starter as `STARTER_ID`), else `/data`, with `skip` the dashboard's id when it
 * holds the widget but is read-only. No session (a share link) is `/data`.
 */
export function showInTarget(
	app: AppContext,
	widgetId: string
): { target: ShowInTarget; skip?: string } {
	const { session, isStarter } = app.current;
	const holds = !!session?.doc.body.widgets.some((w) => w.id === widgetId);
	if (!session || !holds) return { target: { path: "/data" } };
	if (session.readOnly) return { target: { path: "/data" }, skip: session.doc.id };
	return {
		target: { path: "/dashboards/:id/widgets/new", id: isStarter ? STARTER_ID : session.doc.id }
	};
}

/** The conversion's notes the Data Portal shows (`HandOffNotes`). */
function handOffNotes(converted: NowConversion): HandOffNotes {
	const { pollutant, cutAt, selection } = converted;
	const dropped = converted.dropped.filter((d): d is HandOffNotes["dropped"][number] =>
		(HAND_OFF_DROPPED as readonly string[]).includes(d)
	);
	return {
		dropped,
		...(pollutant ? { pollutant: structuredClone(pollutant) } : {}),
		...(cutAt ? { cutAt } : {}),
		...(selection ? { selection: { ...selection } } : {})
	};
}

/**
 * The Data Portal's starting draft for `send` to `type` (Chart or Table), from `map` (the Map's
 * dataset as this person sees it).
 *
 * Monitors: exactly what Show as gives for this Map (`fromMapDraft`, with `"unavailable"` levels,
 * as `GetDataView`'s `setType` calls it), with its Where
 * swapped for the ids (D7, D19). Over the type's cap every id is kept (the Data
 * Portal asks which to keep; `overCap`).
 *
 * A section: always a Chart, whatever `type` says (D1, D15: the card offers only "Show in a
 * chart"), of the use figure the Map draws at that section, with the Map's use filters, over the
 * Map's range at its saved resolution (D10). A Map on Now has no resolution, so it gets the
 * Chart's default range at Automatic.
 */
export function showInDraft(
	map: Draft,
	send: MapSend,
	type: WidgetType,
	catalog: CatalogEntry[],
	now: Date = new Date()
): HandOff {
	if (send.kind === "section") {
		const figure = useFigureOf(mapOptions(map), catalog);
		const filters = mapPesticideFilters(map.data);
		const { dateRange } = map.data;
		const resolution = dateRange ? map.data.resolution : undefined;
		const layer: Layer = {
			dataset: PESTICIDE_USE,
			...(figure ? { entryType: figure } : {}),
			...(filters ? { filters: structuredClone(filters) } : {})
		};
		return {
			draft: {
				type: CHART_TYPE,
				data: {
					dateRange: structuredClone(dateRange ?? chartType.defaultRange ?? DEFAULT_RANGE),
					...(resolution ? { resolution } : {}),
					...sendPlaces(send),
					layers: [layer]
				}
			},
			leftOut: 0
		};
	}
	const converted = fromMapDraft(map, type, catalog, "unavailable", now);
	const { draft } = converted;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars -- replaced in the copy
	const { place, selection, ...rest } = draft.data;
	const main = draft.data.layers[0];
	return {
		draft: { ...draft, data: { ...rest, ...(main ? sendPlaces(send) : {}) } },
		leftOut: send.leftOut,
		notes: handOffNotes(converted)
	};
}

/**
 * Loads what the conversion needs (the catalog), builds the hand-off from
 * the Map's registry entry, and opens the Data Portal with it in history state. Nothing happens
 * when the Map isn't mounted (its entry is gone).
 */
export async function showIn(
	app: AppContext,
	widgetId: string,
	send: MapSend,
	type: "chart" | "table"
): Promise<void> {
	const entry = mapSend(widgetId);
	if (!entry) return;
	const metadata = getMetadata();
	const catalog = await metadata.catalog();
	const handOff = showInDraft(
		entry.draft() as Draft,
		send,
		type === "chart" ? chartType : dataTableType,
		Array.isArray(catalog) ? catalog : []
	);
	const { target, skip } = showInTarget(app, widgetId);
	const getData: HandOff = { ...handOff, ...(skip ? { skip } : {}) };
	if (target.path === "/data") await navigate("/data", { state: { getData } });
	else await navigate(target.path, { params: { id: target.id }, state: { getData } });
}
