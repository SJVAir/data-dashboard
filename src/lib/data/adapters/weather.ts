import { getWeatherStationsForPlace } from "@sjvair/sdk";
import { untilAborted, type CatalogEntry } from "../metadata";
import type { PlaceInfo, QueryData, Series } from "../types";
import { summarySeries } from "./air-quality";
import type { AdapterContext, AdapterRequest, DatasetAdapter } from "./registry";
import { isNotFound, layerTarget, placeCandidates, type PlaceRef } from "./targets";

/** A CIMIS station near a place, in the server's order (inside ones first, then nearest). */
export type WeatherStation = {
	id: string;
	name: string;
	/** Miles from the place's edge (0 when inside). */
	distance: number;
	inside: boolean;
	/** The server's `is_active`; an inactive station may be behind. */
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

async function aggregateOf(
	ctx: AdapterContext,
	entryType: string,
	signal: AbortSignal
): Promise<"sum" | "mean" | null | undefined> {
	const catalog = await ctx.metadata.catalog(signal);
	if (catalog === "unavailable") return undefined;
	const dataset = (catalog as CatalogEntry[]).find((d) => d.id === "weather");
	return dataset?.entryTypes.find((e) => e.id === entryType)?.aggregate;
}

async function fetchWeather(
	req: AdapterRequest,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<QueryData> {
	const { target } = req;
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
 * series match the main layer's places. Totals (precipitation, ETo) read `sum`, the rest `mean`,
 * from the catalog's `aggregate`. There is no "Every measurement": CIMIS readings are hourly, so
 * hourly shows the same values, and entry types with no other level (wind direction) aren't
 * offered.
 */
export const weatherAdapter: DatasetAdapter = {
	id: "weather",
	async target(layer, ctx) {
		const target = await layerTarget(layer, ctx);
		return "unavailable" in target || target.kind !== "all"
			? target
			: { unavailable: "place-unsupported" };
	},
	offered: (base) => base.filter((r) => r !== "raw"),
	overlays: () => true,
	fetch: fetchWeather
};
