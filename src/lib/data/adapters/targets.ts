import type { Layer } from "../schema";
import type { Target, UnavailableReason } from "../types";
import type { RegionResolver } from "./registry";

/** Splits a region key (`<type>:<code>`, the document's region reference) into its parts. */
export function splitRegionKey(key: string): { type: string; code: string } {
	const at = key.indexOf(":");
	return { type: key.slice(0, at), code: key.slice(at + 1) };
}

/** The series `place` for a region key. */
export function regionPlace(key: string): string {
	return `region:${key}`;
}

/** The server id for each region key, or `null` for one the resolver can't look up. */
export async function resolveRegionKeys(
	keys: string[],
	regions: RegionResolver,
	signal?: AbortSignal
): Promise<Array<string | null>> {
	return Promise.all(
		keys.map(async (key) => {
			const { type, code } = splitRegionKey(key);
			const id = await regions.resolve(type, code, signal);
			return id === "unsupported" ? null : id;
		})
	);
}

/**
 * What a layer asks for. Regions stay keyed by their document reference (`<type>:<code>`), so
 * cache keys and series never carry the server's per-database id; they are resolved here only
 * to check that they can be.
 */
export async function layerTarget(
	layer: Layer,
	regions: RegionResolver,
	signal?: AbortSignal
): Promise<Target | { unavailable: UnavailableReason }> {
	const { place, selection } = layer;
	let keys: string[];
	if (place) {
		if (place.kind === "monitor") return { kind: "monitors", ids: [place.id] };
		if (place.kind !== "region") return { unavailable: "place-unsupported" };
		keys = [`${place.type}:${place.code}`];
	} else if (selection) {
		if (selection.kind === "monitors") return { kind: "monitors", ids: [...selection.ids] };
		keys = [...selection.ids];
	} else {
		return { kind: "all" };
	}
	const ids = await resolveRegionKeys(keys, regions, signal);
	if (ids.some((id) => id === null)) return { unavailable: "region-unresolved" };
	return { kind: "regions", keys };
}
