import type { Layer } from "$lib/data/schema";
import type { RegionResolver } from "$lib/data/adapters/registry";
import type { UnavailableReason } from "$lib/data/types";
import type { placeRegion } from "$lib/data";
import { nowInput } from "../../shared/input";

/** Which monitors the places allow: server region ids, or explicit monitor ids. */
export type MonitorScope =
	| { kind: "regions"; ids: string[]; key: string }
	| { kind: "monitors"; ids: string[]; key: string };

export type ScopeContext = { regions: RegionResolver; placeRegion: typeof placeRegion };

function monitors(ids: string[]): MonitorScope {
	const sorted = [...new Set(ids)].sort();
	return { kind: "monitors", ids: sorted, key: sorted.join(",") };
}

/**
 * The monitors a layer's places allow. A region (or several) gives its server ids; a school or
 * point gives its `placeRegion` region (the one the frame uses); monitor places give exactly
 * those monitors. The key holds server ids or monitor ids, never coordinates.
 */
export async function monitorScope(
	layer: Layer,
	ctx: ScopeContext,
	signal?: AbortSignal
): Promise<MonitorScope | { unavailable: UnavailableReason }> {
	const { place, selection } = layer;
	if (selection?.kind === "monitors") return monitors(selection.ids);
	if (place?.kind === "monitor") return monitors([place.id]);

	let refs: { type: string; code: string }[];
	if (selection?.kind === "regions") {
		refs = selection.ids.map((id) => {
			const at = Math.max(id.indexOf(":"), 0);
			return { type: id.slice(0, at), code: id.slice(at + 1) };
		});
	} else if (place?.kind === "region") {
		refs = [{ type: place.type, code: place.code }];
	} else if (place?.kind === "location" || place?.kind === "point") {
		const input = nowInput(layer);
		const region = input ? await ctx.placeRegion(input, signal) : null;
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
	const sorted = [...new Set(ids)].sort();
	return { kind: "regions", ids: sorted, key: sorted.join(",") };
}
