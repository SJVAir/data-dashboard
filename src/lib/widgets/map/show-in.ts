/**
 * "Show in a chart" / "Show in a table" from a Map (lazy, in the Map's chunk): the Data Portal's
 * starting draft for what the Map sends (its sent marks, or one pesticide section), and where to
 * open it. The draft travels in history state (`{ getData: HandOff }`), never in the URL.
 */
import { getMetadata } from "$lib/data";
import type { CatalogEntry } from "$lib/data/metadata";
import type { Layer, PlaceRef, SpatialSelection } from "$lib/data/schema";
import { fromMapDraft, mapPesticideFilters } from "$lib/get-data/map";
import { DraftSchema, type Draft } from "$lib/get-data/draft.svelte";
import { toLayerPlaces } from "$lib/places/selection";
import { STARTER_ID } from "$lib/starter/starter";
import type { AppContext } from "$lib/store/app.svelte";
import { CHART_TYPE, chartType } from "$lib/widgets/chart";
import type { WidgetType } from "$lib/widgets/registry";
import { dataTableType } from "$lib/widgets/table";
import { z } from "$lib/zod";
import { navigate } from "../../../router";
import { PESTICIDE_USE, mapOptions, useFigureOf } from "./options";
import { mapSend } from "./send-registry";

/** What a Map sends: its sent marks (in mark order), or one pinned section card. */
export type MapSend =
	{ kind: "monitors"; ids: string[]; leftOut: number } | { kind: "section"; code: string };
// spec 7 adds a kind here and a case in sendPlaces; nothing else changes.

/** The main layer's places for a send (the plug-in point). Never a `point`. */
export function sendPlaces(send: MapSend): { place?: PlaceRef; selection?: SpatialSelection } {
	switch (send.kind) {
		case "monitors":
			return toLayerPlaces(send.ids.map((id) => ({ kind: "monitor" as const, id })));
		case "section":
			return { place: { kind: "region", type: "mtrs", code: send.code } };
	}
}

/** What travels in history state: the starting draft and counts, never a layer kind. */
export type HandOff = {
	draft: Draft;
	/** The marks left out because they're hidden (the Data Portal's note). */
	leftOut: number;
	/** More places than the type takes: the Data Portal opens the keep dialog. */
	overCap: boolean;
	/** The Map's dashboard when it's read-only, so "Add to" never targets it. */
	skip?: string;
};

/** Validates a hand-off read back from history state (any input; an invalid one is ignored). */
export const HandOffSchema: z.ZodType<HandOff> = z.object({
	draft: DraftSchema,
	leftOut: z.number().int().nonnegative(),
	overCap: z.boolean(),
	skip: z.string().max(200).optional()
});

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

/** `layer` with its places replaced by `places`. */
function withPlaces(layer: Layer, places: ReturnType<typeof sendPlaces>): Layer {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars -- replaced in the copy
	const { place, selection, ...rest } = layer;
	return { ...rest, ...places };
}

/**
 * The Data Portal's starting draft for `send` to `type` (Chart or Table), from `map` (the Map's
 * dataset as this person sees it).
 *
 * Monitors: exactly what Show as gives for this Map (`fromMapDraft`, with `"unavailable"` levels
 * and `drawable` the Map's pollutants, as `GetDataView`'s `setType` calls it), with the main
 * layer's places swapped for the ids (D7, D19). Over the type's cap every id is kept and
 * `overCap` is set (the Data Portal asks which to keep).
 *
 * A section: a Chart of the use figure the Map draws at that section, with the Map's use
 * filters, over the Map's range at its saved resolution (D10).
 */
export function showInDraft(
	map: Draft,
	send: MapSend,
	type: WidgetType,
	catalog: CatalogEntry[],
	drawable: readonly string[],
	now: Date = new Date()
): HandOff {
	if (send.kind === "section") {
		const figure = useFigureOf(mapOptions(map), catalog);
		const filters = mapPesticideFilters(map.data);
		const { dateRange, resolution } = map.data;
		const layer: Layer = {
			dataset: PESTICIDE_USE,
			...(figure ? { entryType: figure } : {}),
			...sendPlaces(send),
			...(filters ? { filters: structuredClone(filters) } : {})
		};
		return {
			draft: {
				type: CHART_TYPE,
				data: {
					dateRange: structuredClone(dateRange ?? chartType.defaultRange!),
					...(resolution ? { resolution } : {}),
					layers: [layer]
				}
			},
			leftOut: 0,
			overCap: false
		};
	}
	const { draft } = fromMapDraft(map, type, catalog, "unavailable", drawable, now);
	const [main, ...rest] = draft.data.layers;
	const places = sendPlaces(send);
	return {
		draft: {
			...draft,
			data: { ...draft.data, layers: main ? [withPlaces(main, places), ...rest] : [] }
		},
		leftOut: send.leftOut,
		overCap: send.ids.length > (type.accepts?.maxPlaces ?? Infinity)
	};
}

/**
 * Loads what the conversion needs (the catalog, the Map's pollutants), builds the hand-off from
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
	const [catalog, pollutants] = await Promise.all([metadata.catalog(), metadata.mapPollutants()]);
	const handOff = showInDraft(
		entry.draft() as Draft,
		send,
		type === "chart" ? chartType : dataTableType,
		Array.isArray(catalog) ? catalog : [],
		pollutants === "unavailable" ? [] : pollutants
	);
	const { target, skip } = showInTarget(app, widgetId);
	const getData: HandOff = { ...handOff, ...(skip ? { skip } : {}) };
	if (target.path === "/data") await navigate("/data", { state: { getData } });
	else await navigate(target.path, { params: { id: target.id }, state: { getData } });
}
