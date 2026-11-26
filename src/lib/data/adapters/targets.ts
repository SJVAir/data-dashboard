import type { getForecastForPlace } from "@sjvair/sdk";
import type { PlaceInfo, QueryLayer, Target, UnavailableReason, Via } from "../types";
import { AIR_QUALITY } from "../layer-kind";
import type { AdapterContext, RegionResolver, ResolvedRegion } from "./registry";

/** Splits a region key (`<type>:<code>`, the document's region reference) into its parts. */
export function splitRegionKey(key: string): { type: string; code: string } {
	const at = key.indexOf(":");
	return { type: key.slice(0, at), code: key.slice(at + 1) };
}

/** The series `place` for a region key. */
export function regionPlace(key: string): string {
	return `region:${key}`;
}

/** The resolved region for each key, or `null` for one the resolver can't look up. */
export async function resolveRegionKeys(
	keys: string[],
	regions: RegionResolver,
	signal?: AbortSignal
): Promise<Array<ResolvedRegion | null>> {
	return Promise.all(
		keys.map(async (key) => {
			const { type, code } = splitRegionKey(key);
			const found = await regions.resolve(type, code, signal);
			return found === "unsupported" ? null : found;
		})
	);
}

/** The keys the region resolver can look up, in their order. */
async function resolvableKeys(
	keys: string[],
	regions: RegionResolver,
	signal?: AbortSignal
): Promise<string[]> {
	const found = await resolveRegionKeys(keys, regions, signal);
	return keys.filter((_, i) => found[i] !== null);
}

/**
 * Whether any of the monitor ids is missing from a loaded monitors list. A list that fails to
 * load says nothing, so the query runs as before (and shows its own error with Retry).
 */
async function anyUnlisted(
	ids: string[],
	metadata: AdapterContext["metadata"],
	signal?: AbortSignal
): Promise<boolean> {
	let listed: Set<string>;
	try {
		listed = new Set((await metadata.monitors(signal)).map((m) => m.id));
	} catch (error) {
		if (signal?.aborted) throw error;
		return false;
	}
	return ids.some((id) => !listed.has(id));
}

/**
 * The region keys a Where stands for, to scope monitors of ticked types: its areas; a school or
 * point's first resolvable region (ZIP, then city, then county). With no Where there are none to
 * count them in (`place-unsupported`): ticked types draw only inside a Where.
 */
async function whereRegionKeys(
	layer: QueryLayer,
	ctx: Pick<AdapterContext, "regions" | "locations" | "points">,
	signal?: AbortSignal
): Promise<string[] | { unavailable: UnavailableReason }> {
	const { place, selection } = layer;
	if (selection) return [...selection.ids];
	if (!place) return { unavailable: "place-unsupported" };
	const fallback = await fallbackTarget(place, ctx, signal);
	// Ticked types with a school or point Where use its first resolvable region only (ZIP, else
	// city, else county), not the fallback chain a by-place query tries in turn.
	if (fallback) return "unavailable" in fallback ? fallback : fallback.keys.slice(0, 1);
	if (place.kind !== "region") return { unavailable: "place-unsupported" };
	return [`${place.type}:${place.code}`];
}

/** A school's or point's region keys to try in order, or `null` for any other place. */
async function fallbackTarget(
	place: NonNullable<QueryLayer["place"]>,
	ctx: Pick<AdapterContext, "regions" | "locations" | "points">,
	signal?: AbortSignal
): Promise<Extract<Target, { kind: "fallback" }> | { unavailable: UnavailableReason } | null> {
	if (place.kind === "location") {
		const found = await ctx.locations.resolve(place.source, place.code, signal);
		const candidates = found ? await resolvableKeys(found.keys, ctx.regions, signal) : [];
		if (!found || candidates.length === 0) return { unavailable: "location-unresolved" };
		const via: Via = {
			kind: "location",
			source: place.source,
			code: place.code,
			name: found.name,
			...(found.retired && { retired: found.retired })
		};
		return { kind: "fallback", via, keys: candidates };
	}
	if (place.kind === "point") {
		const found = await ctx.points.keys(place.lat, place.lon, signal);
		const candidates = await resolvableKeys(found, ctx.regions, signal);
		if (candidates.length === 0) return { unavailable: "point-outside" };
		return { kind: "fallback", via: { kind: "point" }, keys: candidates };
	}
	return null;
}

/**
 * The ticked types and searched monitors that measure the layer's pollutant (spec decision 32: a
 * type or monitor that doesn't is kept in the document, greyed out, and not fetched). A type the
 * monitors meta doesn't list, or a monitor whose type it doesn't, isn't known not to, so it stays;
 * a meta or list that fails to load drops nothing. Only an air-quality layer has a pollutant: any
 * other dataset's layer (a weather or forecasts overlay at a Chart's monitors) takes the monitors
 * as places, whatever they measure. The same rule greys them out in the Data Portal (`blockFor`
 * in `$lib/get-data/monitor-choices`): change both together.
 */
async function measuring(
	layer: QueryLayer,
	ids: string[],
	types: string[],
	metadata: AdapterContext["metadata"],
	signal?: AbortSignal
): Promise<{ ids: string[]; types: string[] }> {
	const entryType = layer.entryType;
	if (layer.dataset !== AIR_QUALITY || !entryType || (ids.length === 0 && types.length === 0)) {
		return { ids, types };
	}
	let measures: (type: string | undefined) => boolean;
	let typeOf: Map<string, string>;
	try {
		const [info, list] = await Promise.all([
			metadata.monitorTypes(signal),
			ids.length > 0 ? metadata.monitors(signal) : Promise.resolve([])
		]);
		const byType = new Map(info.map((t) => [t.type, t]));
		measures = (type) => {
			const known = type === undefined ? undefined : byType.get(type);
			return !known || known.entryTypes.includes(entryType);
		};
		typeOf = new Map(list.map((mon) => [mon.id, mon.type]));
	} catch (error) {
		if (signal?.aborted) throw error;
		return { ids, types };
	}
	return {
		ids: ids.filter((id) => measures(typeOf.get(id))),
		types: types.filter((type) => measures(type))
	};
}

/**
 * What a layer asks for. Its monitors come first: ticked types make a `monitor-set` (those types
 * inside the Where's regions, plus the searched monitors); searched monitors alone
 * are those monitors, wherever they are (Where doesn't narrow them). With neither, its Where:
 * regions stay keyed by their document reference (`<type>:<code>`), so cache keys and series
 * never carry the server's per-database id; they are resolved here only to check that they can
 * be. A point or a school becomes its region keys to try in order, so its coordinates never reach
 * a cache key or a request beyond the point lookup. No Where and no monitors: nothing (`place-unsupported`).
 * Ticked types and searched monitors that don't measure the pollutant are left out (`measuring`);
 * with none left, nothing is fetched (`none-measure`).
 */
export async function layerTarget(
	layer: QueryLayer,
	ctx: Pick<AdapterContext, "regions" | "locations" | "points" | "metadata">,
	signal?: AbortSignal
): Promise<Target | { unavailable: UnavailableReason }> {
	const saved = { ids: [...(layer.monitors ?? [])], types: [...(layer.monitorTypes ?? [])] };
	if (saved.ids.length > 0 && (await anyUnlisted(saved.ids, ctx.metadata, signal))) {
		return { unavailable: "monitor-unlisted" };
	}
	const { ids, types } = await measuring(layer, saved.ids, saved.types, ctx.metadata, signal);
	// Monitors asked for, none measuring the pollutant: nothing to fetch (never an empty type
	// list, which the bulk endpoints read as every type; never the Where's own figure), and the
	// widget says why.
	if (ids.length === 0 && types.length === 0 && (saved.ids.length || saved.types.length)) {
		return { unavailable: "none-measure" };
	}
	if (types.length > 0) {
		const regionKeys = await whereRegionKeys(layer, ctx, signal);
		if (!Array.isArray(regionKeys)) return regionKeys;
		// No areas is no place: never a bulk request with no region (every monitor of the types).
		if (regionKeys.length === 0) return { unavailable: "place-unsupported" };
		const found = await resolveRegionKeys(regionKeys, ctx.regions, signal);
		if (found.some((r) => r === null)) return { unavailable: "region-unresolved" };
		return { kind: "monitor-set", ids, types, regionKeys };
	}
	if (ids.length > 0) return { kind: "monitors", ids };
	const { place, selection } = layer;
	let keys: string[];
	if (place) {
		const fallback = await fallbackTarget(place, ctx, signal);
		if (fallback) return fallback;
		if (place.kind !== "region") return { unavailable: "place-unsupported" };
		keys = [`${place.type}:${place.code}`];
	} else if (selection) {
		keys = [...selection.ids];
	} else {
		// No Where and no monitors: nothing to fetch (widgets don't ask; see `chartInput`).
		return { unavailable: "place-unsupported" };
	}
	const found = await resolveRegionKeys(keys, ctx.regions, signal);
	if (found.some((r) => r === null)) return { unavailable: "region-unresolved" };
	return { kind: "regions", keys };
}

/** What a by-place endpoint takes (the same for forecasts, weather stations and smoke). */
export type PlaceRef = Parameters<typeof getForecastForPlace>[0];

/** A place asked about: what to ask the server, and the place it names (its series key too). */
export type Candidate = { ref: PlaceRef; info: PlaceInfo };

/** Whether an SDK error is the server's 404 ("no such region"). */
export function isNotFound(error: unknown): boolean {
	const cause = error instanceof Error ? (error.cause as { result?: { status?: number } }) : null;
	return cause?.result?.status === 404;
}

function regionRef(key: string): PlaceRef {
	const { type, code } = splitRegionKey(key);
	return { region: { type: type as never, external_id: code } };
}

/**
 * The places to ask about, each with the server references to try (a fallback has several). A
 * fallback's first key answers for any region-based by-place endpoint; later keys only stand in for
 * one the server doesn't know.
 */
export async function placeCandidates(
	target: Target,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<Candidate[][]> {
	if (target.kind === "monitors") {
		const monitors = await ctx.metadata.monitors(signal);
		const names = new Map(monitors.map((m) => [m.id, m.name]));
		return target.ids.map((id) => [
			{ ref: { monitor: id }, info: { place: `monitor:${id}`, name: names.get(id) ?? id } }
		]);
	}
	// Only the air-quality layer has ticked types, and it fetches them in bulk.
	if (target.kind === "monitor-set") throw new Error("A monitor set has no by-place candidates");
	const found = await resolveRegionKeys(target.keys, ctx.regions, signal);
	const named = target.keys.map((key, i): Candidate => {
		const region = found[i];
		if (region === null) throw new Error(`Region ${key} can't be looked up`);
		return {
			ref: regionRef(key),
			info: {
				place: regionPlace(key),
				name: region.name,
				...(region.retired && { retired: region.retired })
			}
		};
	});
	return target.kind === "fallback" ? [named] : named.map((c) => [c]);
}
