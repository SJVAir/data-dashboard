import { currentInput } from "$lib/data/now/current";
import type { RegionResolver } from "$lib/data/adapters/registry";
import type { QueryLayer, UnavailableReason } from "$lib/data/types";
import type { placeRegion } from "$lib/data";

/** Which monitors the places allow: server region ids, or explicit monitor ids. */
export type MonitorScope =
	| { kind: "regions"; ids: string[]; key: string }
	| { kind: "monitors"; ids: string[]; key: string };

export type ScopeContext = { regions: RegionResolver; placeRegion: typeof placeRegion };

/** A scope of `kind` over `ids`, deduplicated and sorted so the key is stable. */
function scopeOf(kind: MonitorScope["kind"], ids: string[]): MonitorScope {
	const sorted = [...new Set(ids)].sort();
	return { kind, ids: sorted, key: sorted.join(",") };
}

/**
 * The monitors a layer's places allow. A region (or several) gives its server ids; a school or
 * point gives its `placeRegion` region (the one the frame uses); monitor places give exactly
 * those monitors. The key holds server ids or monitor ids, never coordinates.
 */
export async function monitorScope(
	layer: QueryLayer,
	ctx: ScopeContext,
	signal?: AbortSignal
): Promise<MonitorScope | { unavailable: UnavailableReason }> {
	const { place, selection } = layer;
	if (selection?.kind === "monitors") return scopeOf("monitors", selection.ids);
	if (place?.kind === "monitor") return scopeOf("monitors", [place.id]);

	let refs: { type: string; code: string }[];
	if (selection?.kind === "regions") {
		refs = selection.ids.map((id) => {
			const at = Math.max(id.indexOf(":"), 0);
			return { type: id.slice(0, at), code: id.slice(at + 1) };
		});
	} else if (place?.kind === "region") {
		refs = [{ type: place.type, code: place.code }];
	} else if (place?.kind === "location" || place?.kind === "point") {
		const region = await ctx.placeRegion(currentInput(layer), signal);
		if (!region) return { unavailable: "point-outside" };
		refs = [region];
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
	return scopeOf("regions", ids);
}
