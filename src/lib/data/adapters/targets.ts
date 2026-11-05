import type { Layer } from "../schema";
import type { Target, UnavailableReason, Via } from "../types";
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
 * What a layer asks for. Regions stay keyed by their document reference (`<type>:<code>`), so
 * cache keys and series never carry the server's per-database id; they are resolved here only
 * to check that they can be. A point or a school becomes its region keys to try in order, so its
 * coordinates never reach a cache key or a request beyond the point lookup.
 */
export async function layerTarget(
	layer: Layer,
	ctx: Pick<AdapterContext, "regions" | "locations" | "points">,
	signal?: AbortSignal
): Promise<Target | { unavailable: UnavailableReason }> {
	const { place, selection } = layer;
	let keys: string[];
	if (place) {
		if (place.kind === "monitor") return { kind: "monitors", ids: [place.id] };
		if (place.kind === "location") {
			const found = await ctx.locations.resolve(place.source, place.code, signal);
			const candidates = found ? await resolvableKeys(found.keys, ctx.regions, signal) : [];
			if (!found || candidates.length === 0) return { unavailable: "location-unresolved" };
			const via: Via = {
				kind: "location",
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
		if (place.kind !== "region") return { unavailable: "place-unsupported" };
		keys = [`${place.type}:${place.code}`];
	} else if (selection) {
		if (selection.kind === "monitors") return { kind: "monitors", ids: [...selection.ids] };
		keys = [...selection.ids];
	} else {
		return { kind: "all" };
	}
	const found = await resolveRegionKeys(keys, ctx.regions, signal);
	if (found.some((r) => r === null)) return { unavailable: "region-unresolved" };
	return { kind: "regions", keys };
}
