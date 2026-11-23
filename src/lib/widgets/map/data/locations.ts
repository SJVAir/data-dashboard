import { getPesticideLocations, type PesticideLocationFeature } from "@sjvair/sdk";
import type { DataStatus, SchoolsSource } from "@sjvair/map-sdk/data";
import { getResolvers, placeRegion } from "$lib/data";
import type { ResolvedRegion } from "$lib/data/adapters/registry";
import { untilAborted } from "$lib/data/metadata";
import { unavailableMessage } from "$lib/data/messages";
import type { NowState } from "$lib/data/now/client";
import { currentInput } from "$lib/data/now/current";
import type { WidgetDataConfig } from "$lib/data/schema";
import type { UnavailableReason } from "$lib/data/types";
import { locationsLayer } from "$lib/get-data/map";
import { DEFAULT_LAYER } from "$lib/widgets/defaults";
import { mainLayer, queryLayer, widgetWhere } from "$lib/widgets/shared/input";
import { mapMessages } from "../host/messages";
import { dataStatus } from "./status";
import type { MapDataEntry } from "./types";

/** The loaded schools and child care sites, every type (the Map filters by the ticked ones). */
export type LocationsData = { features: PesticideLocationFeature[] };

type RegionRef = { type: string; code: string };

/**
 * A `type:code` region key (a selection id, or a school's fallback key) as a reference; null
 * without a colon.
 */
function regionRef(key: string): RegionRef | null {
	const at = key.indexOf(":");
	return at < 0 ? null : { type: key.slice(0, at), code: key.slice(at + 1) };
}

/** Each ref's sqid, looked up together; "unsupported" or null as the resolver answers. */
function resolveAll(refs: (RegionRef | null)[], signal?: AbortSignal) {
	const { regions } = getResolvers();
	return Promise.all(
		refs.map((ref) => (ref ? regions.resolve(ref.type, ref.code, signal) : Promise.resolve(null)))
	);
}

type Areas = string[] | "everywhere" | { unavailable: UnavailableReason };

/**
 * The region sqids the layer loads for `data`'s Where (sorted, each once); "everywhere" with no
 * Where; `{ unavailable }` when a pick has no region on the server. A region is itself, each of a
 * selection's areas too; a school is the first of its fallback keys (ZIP, city, county) whose
 * region the server has, and gone only when none has one; a point is the
 * region `placeRegion` gives, looked up for the Map's pollutant (PM2.5 without one, as a shared
 * point's is).
 */
export async function locationAreas(data: WidgetDataConfig, signal?: AbortSignal): Promise<Areas> {
	const { place, selection } = widgetWhere(data);
	let refs: (RegionRef | null)[];
	if (selection) {
		refs = selection.ids.map(regionRef);
	} else if (place?.kind === "region") {
		refs = [{ type: place.type, code: place.code }];
	} else if (place?.kind === "location") {
		const found = await getResolvers().locations.resolve(place.source, place.code, signal);
		if (!found?.keys.length) return { unavailable: "location-unresolved" };
		const regions = await resolveAll(found.keys.map(regionRef), signal);
		const region = regions.find((r): r is ResolvedRegion => r !== null && r !== "unsupported");
		if (!region) return { unavailable: "region-unresolved" };
		return [region.id];
	} else if (place?.kind === "point") {
		const layer = mainLayer(data, undefined) ?? DEFAULT_LAYER;
		const region = await placeRegion(currentInput(queryLayer(data, layer)), signal);
		if (!region) return { unavailable: "point-outside" };
		refs = [region];
	} else if (place) {
		// The starter's unresolved `default-place` isn't fetched.
		return { unavailable: "place-unsupported" };
	} else {
		return "everywhere";
	}
	// Looked up together; the first that can't be, in the Where's order, says why.
	const ids: string[] = [];
	for (const found of await resolveAll(refs, signal)) {
		if (found === "unsupported") return { unavailable: "place-unsupported" };
		if (!found) return { unavailable: "region-unresolved" };
		ids.push(found.id);
	}
	return [...new Set(ids)].sort();
}

/**
 * Each region's sites, by sqid: fetched once a session and shared by every Map (sites change
 * rarely). A failed fetch is forgotten, so the next load asks again. The shared fetch carries no
 * caller's signal, so one caller's abort rejects only its own load.
 */
const areaSites = new Map<string, Promise<PesticideLocationFeature[]>>();

function sitesIn(sqid: string): Promise<PesticideLocationFeature[]> {
	let request = areaSites.get(sqid);
	if (!request) {
		request = getPesticideLocations({ region: sqid }).then((c) => c.features);
		const made = request;
		made.catch(() => {
			if (areaSites.get(sqid) === made) areaSites.delete(sqid);
		});
		areaSites.set(sqid, made);
	}
	return request;
}

/** Forgets every area's sites (for tests). */
export function resetLocationsCache(): void {
	areaSites.clear();
}

/**
 * The sites in `areas`, each once (by feature id); one area's list as it came (never copied). One
 * area failing fails the load: never a partial list.
 */
async function sitesInAreas(areas: string[], signal: AbortSignal): Promise<LocationsData> {
	const lists = await Promise.all(areas.map((sqid) => untilAborted(sitesIn(sqid), signal)));
	if (lists.length === 1) return { features: lists[0] };
	const byId = new Map<string, PesticideLocationFeature>();
	for (const list of lists) for (const feature of list) byId.set(feature.id, feature);
	return { features: [...byId.values()] };
}

/**
 * The schools and child care sites in the Map's Where, every type (ticking a type filters what's
 * loaded, never refetches): nothing without the layer or with no type ticked. Sites have no time,
 * so the day showing is ignored and the key holds only the areas' sqids; the Map never polls it.
 * With no Where it is unavailable for now: the pinned SDK needs an area, and the valley-wide load
 * is wired separately.
 */
export const locationsEntry: MapDataEntry<LocationsData, never, { locations: SchoolsSource }> = {
	id: "locations",
	async source({ data }, signal) {
		if (!locationsLayer(data)?.locationTypes?.length) return null;
		const areas = await locationAreas(data, signal);
		if (areas === "everywhere") return { unavailable: "place-unsupported" };
		if (!Array.isArray(areas)) return areas;
		return {
			key: `map-locations:${areas.join(",")}`,
			cadence: "hour",
			fetch: (s) => sitesInAreas(areas, s)
		};
	},
	toDataSources({ features }) {
		return {
			locations: { status: { state: "ready" }, features: { type: "FeatureCollection", features } }
		};
	}
};

/**
 * The locations' one source, shared by every group's plugin (each filters it by its types): its
 * getters read the latest load, so a refetch never makes a plugin again. Unavailable (a Where with
 * no region on the server) says why in the legend; no features until the sites load.
 */
export function locationsSourceOf(d: {
	readonly locationsState: NowState<LocationsData>;
	readonly locationsUnavailable: UnavailableReason | undefined;
}): SchoolsSource {
	let loaded: LocationsData | undefined;
	let drawn: SchoolsSource["features"] = null;
	return {
		get status(): DataStatus {
			const reason = d.locationsUnavailable;
			if (!reason) return dataStatus(d.locationsState);
			// The legend's status row says why (the map's note too).
			return { state: "unavailable", reason, message: unavailableMessage(reason) };
		},
		get features() {
			const data = d.locationsState.data;
			if (data === undefined) return null;
			// The same collection for the same load (never a new one per read).
			if (data !== loaded) {
				loaded = data;
				drawn = locationsEntry.toDataSources(data, { messages: mapMessages, entryType: "" })
					.locations.features;
			}
			return drawn;
		}
	};
}
