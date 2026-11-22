import { getWeatherStationsForPlace } from "@sjvair/sdk";
import { untilAborted, type CatalogEntry } from "../metadata";
import type { PlaceInfo, QueryData, QueryLayer, Series } from "../types";
import { namedSummarySeries, summarySeries } from "./air-quality";
import { offeredLevels } from "./offered";
import type { AdapterContext, AdapterRequest, DatasetAdapter } from "./registry";
import { isNotFound, layerTarget, placeCandidates, type PlaceRef } from "./targets";

/** A CIMIS station near a place, in the server's order (inside ones first, then nearest). */
export type WeatherStation = {
	id: string;
	name: string;
	/** Miles from the place's edge (0 when inside). */
	distance: number;
	inside: boolean;
	/** The server's `is_active`; an inactive station has no recent data. */
	active: boolean;
};

const stations = new Map<string, Promise<WeatherStation[]>>();

/** Forgets every remembered station list (for tests). */
export function resetStationCache(): void {
	stations.clear();
}

function refKey(ref: PlaceRef): string {
	return "monitor" in ref
		? `monitor:${ref.monitor}`
		: `${ref.region.type}:${ref.region.external_id}`;
}

/**
 * The weather stations of a place, in the server's order, remembered per place for the session
 * (the shared request carries no caller's signal). A place the server doesn't know has none.
 */
export function stationsFor(ref: PlaceRef, signal?: AbortSignal): Promise<WeatherStation[]> {
	const key = refKey(ref);
	let found = stations.get(key);
	if (!found) {
		const request = getWeatherStationsForPlace(ref).then(
			(r) =>
				r.stations.map((s) => ({
					id: s.id,
					name: s.name,
					distance: s.distance,
					inside: s.inside,
					active: s.is_active
				})),
			(error: unknown) => {
				if (isNotFound(error)) return [];
				throw error;
			}
		);
		found = request;
		stations.set(key, request);
		// A failure is forgotten so the next call retries.
		request.catch(() => {
			if (stations.get(key) === request) stations.delete(key);
		});
	}
	return untilAborted(found, signal);
}

/** The saved station if it is still listed, else the first; none for an empty list. */
export function stationChoice(
	list: WeatherStation[],
	saved: string | undefined
): WeatherStation | undefined {
	return list.find((s) => s.id === saved) ?? list[0];
}

/**
 * The stations Get data's station choice lists for a layer's one place: those of the first
 * candidate that has any (a school or point falls back through its regions, as the fetch does).
 * None for several places, for no place, or for a place that can't be looked up.
 */
export async function layerStations(
	layer: Pick<QueryLayer, "dataset" | "place" | "selection">,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<WeatherStation[]> {
	const target = await layerTarget(layer, ctx, signal);
	if ("unavailable" in target) return [];
	const groups = await placeCandidates(target, ctx, signal);
	if (groups.length !== 1) return [];
	for (const candidate of groups[0]) {
		const list = await stationsFor(candidate.ref, signal);
		if (list.length > 0) return list;
	}
	return [];
}

/** The catalog's weather entry; `undefined` when the catalog is unavailable or lacks it. */
async function weatherEntry(
	ctx: Pick<AdapterContext, "metadata">,
	signal?: AbortSignal
): Promise<CatalogEntry | undefined> {
	const catalog = await ctx.metadata.catalog(signal);
	if (catalog === "unavailable") return undefined;
	return (catalog as CatalogEntry[]).find((d) => d.id === "weather");
}

async function aggregateOf(
	ctx: AdapterContext,
	entryType: string,
	signal: AbortSignal
): Promise<"sum" | "mean" | null | undefined> {
	return (await weatherEntry(ctx, signal))?.entryTypes.find((e) => e.id === entryType)?.aggregate;
}

/** The monitor types weather stations are (the catalog's `monitor_types`); none when unlisted. */
async function stationTypes(
	ctx: Pick<AdapterContext, "metadata">,
	signal?: AbortSignal
): Promise<string[]> {
	return (await weatherEntry(ctx, signal))?.monitorTypes ?? [];
}

/**
 * No Where: every station, one series each, from the bulk monitor summaries of the catalog's
 * weather `monitor_types` (stations are monitors the monitors list leaves out, so each is named
 * from the response).
 */
async function fetchEveryStation(
	req: AdapterRequest,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<QueryData> {
	const [types, aggregate] = await Promise.all([
		stationTypes(ctx, signal),
		aggregateOf(ctx, req.entryType, signal)
	]);
	// `target()` refuses the whole layer when the catalog names no types: an empty list would
	// ask for every public monitor type instead.
	if (types.length === 0) throw new Error("The catalog names no weather station types");
	const { series, names } = await namedSummarySeries(
		req,
		[],
		[],
		signal,
		{ total: aggregate === "sum", completeness: true },
		{ type: types }
	);
	return {
		series,
		places: series.map((s) => {
			const id = s.place.slice("monitor:".length);
			return { place: s.place, name: names.get(id) ?? id };
		}),
		resolution: req.resolution,
		fromRaw: false,
		processor: null,
		fetchedAt: req.now.getTime()
	};
}

async function fetchWeather(
	req: AdapterRequest,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<QueryData> {
	const { target } = req;
	if (target.kind === "all") return fetchEveryStation(req, ctx, signal);
	const [groups, aggregate] = await Promise.all([
		placeCandidates(target, ctx, signal),
		aggregateOf(ctx, req.entryType, signal)
	]);
	// One place may be moved to another station; with several, each uses its own default.
	const override = groups.length === 1 ? req.station : undefined;
	const total = aggregate === "sum";

	const answers = await Promise.all(
		groups.map(async (group): Promise<{ info: PlaceInfo; series: Series }> => {
			// The first candidate with any station answers (a fallback tries its next key only when
			// the first has none).
			for (const candidate of group) {
				const chosen = stationChoice(await stationsFor(candidate.ref, signal), override);
				if (!chosen) continue;
				const stationReq: AdapterRequest = {
					...req,
					target: { kind: "monitors", ids: [chosen.id] }
				};
				const [series] = await summarySeries(
					stationReq,
					[{ place: candidate.info.place, id: chosen.id }],
					[null],
					signal,
					{ total, completeness: true }
				);
				const { id, name, distance, inside } = chosen;
				return { info: { ...candidate.info, source: { id, name, distance, inside } }, series };
			}
			const last = group[group.length - 1];
			return { info: last.info, series: { place: last.info.place, points: [] } };
		})
	);
	return {
		series: answers.map((a) => a.series),
		places: answers.map((a) =>
			target.kind === "fallback" ? { ...a.info, via: target.via } : a.info
		),
		resolution: req.resolution,
		fromRaw: false,
		processor: null,
		fetchedAt: req.now.getTime()
	};
}

/**
 * CIMIS weather: summaries of the place's nearest station, drawn under the place's own key so the
 * series match the main layer's places; with no Where, every station (`fetchEveryStation`).
 * Totals (precipitation, ETo) read `sum`, the rest `mean`, from the catalog's `aggregate`. There is
 * no "Every measurement": CIMIS readings are hourly, so hourly shows the same values, and entry
 * types with no other level (wind direction) aren't offered.
 */
export const weatherAdapter: DatasetAdapter = {
	id: "weather",
	async target(layer, ctx) {
		const target = await layerTarget(layer, ctx);
		if ("unavailable" in target || target.kind !== "all") return target;
		// Every station needs the catalog's station types to ask for.
		return (await stationTypes(ctx)).length > 0 ? target : { unavailable: "place-unsupported" };
	},
	offered: (base) => offeredLevels("weather", base),
	overlays: () => true,
	fetch: fetchWeather
};
