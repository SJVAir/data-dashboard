import type { AdapterContext, RegionResolver } from "$lib/data/adapters/registry";
import type { MetadataSource } from "$lib/data/metadata";
import type { PlaceRef } from "$lib/data/schema";
import { createPlaceDirectory, type PlaceDirectory } from "./directory";
import type { Picks } from "./selection";
import type { PlaceOption } from "./types";

/** What a place picker's host looks places up with. */
export type Resolvers = Pick<AdapterContext, "regions" | "locations" | "points">;

/** One directory for the app's metadata and resolvers (its lists are fetched once). */
let shared: {
	metadata: MetadataSource;
	regions: RegionResolver;
	directory: PlaceDirectory;
} | null = null;

export function directoryFor(metadata: MetadataSource, regions: RegionResolver): PlaceDirectory {
	if (shared?.metadata !== metadata || shared.regions !== regions) {
		shared = { metadata, regions, directory: createPlaceDirectory({ metadata, regions }) };
	}
	return shared.directory;
}

/** A place's option with its current name; null when it no longer resolves. */
export async function resolveOption(
	ref: PlaceRef,
	ctx: { directory: PlaceDirectory; resolvers: Resolvers; entryType: string },
	signal: AbortSignal
): Promise<PlaceOption | null> {
	switch (ref.kind) {
		case "monitor": {
			const monitors = await ctx.directory.monitors(ctx.entryType, { activeOnly: false }, signal);
			return monitors.find((o) => o.id === ref.id) ?? null;
		}
		case "region": {
			const [found, labels] = await Promise.all([
				ctx.resolvers.regions.resolve(ref.type, ref.code, signal),
				ctx.directory.regionTypeLabels(signal)
			]);
			const typeLabel = labels.get(ref.type);
			if (!found || found === "unsupported" || !typeLabel) return null;
			return {
				kind: "region",
				type: ref.type,
				code: ref.code,
				name: found.name,
				typeLabel,
				county: null
			};
		}
		case "location": {
			const [found, types] = await Promise.all([
				ctx.resolvers.locations.resolve(ref.source, ref.code, signal),
				ctx.directory.locationTypes(signal)
			]);
			const details = found?.details;
			const typeLabel = details && types.find((t) => t.type === details.type)?.label;
			if (!found || !details || !typeLabel) return null;
			return {
				kind: "location",
				source: ref.source,
				code: ref.code,
				name: found.name,
				typeLabel,
				city: details.city,
				zip: details.zip,
				address: details.address
			};
		}
		default:
			return null;
	}
}

/** The kinds of place looked up by code, so a pick of one can be gone. */
const RESOLVED = new Set(["monitor", "region", "location"]);

/**
 * What a picker opens with: the picks still worth showing, their options (to name the chips),
 * and the recent places' options. A monitor, region or school that no longer resolves isn't
 * picked again ("Choose another" replaces it); one whose lookup failed may still exist, so it
 * stays (unnamed), as do points.
 */
export async function resolvePicks(
	initial: Picks,
	recentRefs: PlaceRef[],
	ctx: { directory: PlaceDirectory; resolvers: Resolvers; entryType: string },
	signal: AbortSignal
): Promise<{ initial: Picks; known: PlaceOption[]; recent: PlaceOption[] }> {
	// `null`: the place no longer resolves; `undefined`: its lookup failed.
	const resolve = (ref: PlaceRef) => resolveOption(ref, ctx, signal).catch(() => undefined);
	const [known, recent] = await Promise.all([
		Promise.all(initial.map(resolve)),
		Promise.all(recentRefs.map(resolve))
	]);
	return {
		initial: initial.filter((ref, i) => !(RESOLVED.has(ref.kind) && known[i] === null)),
		known: known.filter((o): o is PlaceOption => o != null),
		recent: recent.filter((o): o is PlaceOption => o != null)
	};
}
