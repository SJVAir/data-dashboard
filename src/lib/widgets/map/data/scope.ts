import { currentInput } from "$lib/data/now/current";
import type { RegionResolver } from "$lib/data/adapters/registry";
import type { QueryLayer, UnavailableReason } from "$lib/data/types";
import type { placeRegion } from "$lib/data";

/**
 * Which monitors the Map draws: every monitor of `types` inside the regions `regionIds` (server
 * ids; `null` for everywhere) plus the searched monitors `ids` wherever they are, or (no ticked
 * types) exactly the searched monitors.
 */
export type MonitorScope =
	| { kind: "monitor-set"; types: string[]; regionIds: string[]; ids: string[]; key: string }
	| { kind: "monitors"; ids: string[]; key: string };

export type ScopeContext = { regions: RegionResolver; placeRegion: typeof placeRegion };

/** Deduplicated and sorted, so a key made of it is stable. */
function sorted(ids: string[]): string[] {
	return [...new Set(ids)].sort();
}

/**
 * The server ids of the regions a Where stands for: its regions; a school or point's
 * `placeRegion` region (the one the frame uses). Ticked types draw only inside a Where, so with
 * none there is nothing to count them in (`queryLayer` doesn't pass them then).
 */
async function whereRegionIds(
	layer: QueryLayer,
	ctx: ScopeContext,
	signal?: AbortSignal
): Promise<string[] | { unavailable: UnavailableReason }> {
	const { place, selection } = layer;
	let refs: { type: string; code: string }[];
	if (selection) {
		refs = selection.ids.map((id) => {
			const at = Math.max(id.indexOf(":"), 0);
			return { type: id.slice(0, at), code: id.slice(at + 1) };
		});
	} else if (place?.kind === "region") {
		refs = [{ type: place.type, code: place.code }];
	} else if (place?.kind === "location" || place?.kind === "point") {
		// The place's own region (`placeRegion` leaves the layer's monitors out).
		const region = await ctx.placeRegion(currentInput(layer), signal);
		if (!region) return { unavailable: "point-outside" };
		refs = [region];
	} else if (place) {
		// The starter's unresolved `default-place` isn't fetched.
		return { unavailable: "place-unsupported" };
	} else {
		return { unavailable: "place-unsupported" };
	}
	const ids: string[] = [];
	for (const ref of refs) {
		const found = await ctx.regions.resolve(ref.type, ref.code, signal);
		if (found === "unsupported") return { unavailable: "place-unsupported" };
		if (!found) return { unavailable: "region-unresolved" };
		ids.push(found.id);
	}
	return ids;
}

/**
 * The monitors a Map's air-quality layer asks for (spec decision 10): its ticked types inside the
 * Where's regions plus its searched monitors; only the
 * searched monitors with no ticked types; `null` (no monitors drawn) with neither, as for a
 * layer whose `queryLayer` carries none (no pollutant chosen). The key holds server ids, types
 * and monitor ids, never coordinates.
 */
export async function monitorScope(
	layer: QueryLayer,
	ctx: ScopeContext,
	signal?: AbortSignal
): Promise<MonitorScope | { unavailable: UnavailableReason } | null> {
	const ids = sorted(layer.monitors ?? []);
	const types = sorted(layer.monitorTypes ?? []);
	if (types.length === 0) {
		return ids.length > 0 ? { kind: "monitors", ids, key: ids.join(",") } : null;
	}
	const found = await whereRegionIds(layer, ctx, signal);
	if (!Array.isArray(found)) return found;
	const regionIds = sorted(found);
	const key = [types.join(","), regionIds.join(","), ids.join(",")].join("|");
	return { kind: "monitor-set", types, regionIds, ids, key };
}
