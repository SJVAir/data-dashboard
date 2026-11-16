import { getRegionsGeoJSON, type RegionFeature, type RegionType } from "@sjvair/sdk";
import type { Feature } from "geojson";

/** A region as a layer names it: its type and its code (the region's external id). */
export type RegionRef = { type: string; code: string };

/** The `shapes` key of a region: `type:code`. */
export function regionKey(ref: RegionRef): string {
	return `${ref.type}:${ref.code}`;
}

/**
 * The region types the server simplifies: its GeoJSON endpoint refuses `simplify=1` for any
 * other (the regions meta doesn't say which; see DEFERRED.md). Others load unsimplified.
 */
const SIMPLIFIED_TYPES: ReadonlySet<string> = new Set(["county", "zipcode", "tract"]);

/** Whether the server simplifies `type`'s shapes. */
export function simplifies(type: string): boolean {
	return SIMPLIFIED_TYPES.has(type);
}

/** Region shapes fetched this page, by `type:code`, shared by every map. */
const cache = new Map<string, Feature>();
/** Every current region of a type (a fill's), fetched this page, shared by every map. */
const typeCache = new Map<string, RegionFeature[]>();

/**
 * The shapes of `refs`, by `type:code` (simplified where the server does, for outlines). Codes
 * not cached yet go out in one request per region type; a region the server doesn't return is
 * left out of the map.
 */
export async function regionShapes(
	refs: RegionRef[],
	signal?: AbortSignal
): Promise<Map<string, Feature>> {
	const missing = new Map<string, Set<string>>();
	for (const ref of refs) {
		if (cache.has(regionKey(ref))) continue;
		const codes = missing.get(ref.type) ?? new Set<string>();
		codes.add(ref.code);
		missing.set(ref.type, codes);
	}
	await Promise.all(
		[...missing].map(async ([type, codes]) => {
			const collection = await getRegionsGeoJSON(
				{ type: type as RegionType, external_id: [...codes], simplify: simplifies(type) },
				{ signal }
			);
			for (const feature of collection.features) {
				const code = feature.properties.external_id;
				if (code && codes.has(code)) cache.set(regionKey({ type, code }), feature as Feature);
			}
		})
	);
	const shapes = new Map<string, Feature>();
	for (const ref of refs) {
		const shape = cache.get(regionKey(ref));
		if (shape) shapes.set(regionKey(ref), shape);
	}
	return shapes;
}

/**
 * Every current region of `type` (one request, simplified where the server does), fetched once
 * per page. Its shapes also serve later outlines of the same regions.
 */
export async function regionTypeShapes(
	type: RegionType,
	signal?: AbortSignal
): Promise<RegionFeature[]> {
	const cached = typeCache.get(type);
	if (cached) return cached;
	const collection = await getRegionsGeoJSON({ type, simplify: simplifies(type) }, { signal });
	const features = collection.features;
	typeCache.set(type, features);
	for (const feature of features) {
		const code = feature.properties.external_id;
		if (code) cache.set(regionKey({ type, code }), feature as Feature);
	}
	return features;
}
