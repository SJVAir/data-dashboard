import type { ResolvedRange } from "$lib/format/range";
import type { MetadataSource } from "../metadata";
import type { Layer, Resolution } from "../schema";
import type { QueryData, Target, UnavailableReason } from "../types";

/** Looks up a region's server id from its document reference; `null` when there is none. */
export interface RegionResolver {
	resolve(type: string, code: string, signal?: AbortSignal): Promise<string | "unsupported" | null>;
}

export type AdapterContext = { metadata: MetadataSource; regions: RegionResolver };

export type AdapterRequest = {
	entryType: string;
	target: Target;
	resolution: Resolution;
	downsampleFromRaw: boolean;
	range: ResolvedRange;
	/** The levels this adapter can fetch for `target` (see `DatasetAdapter.offered`). */
	offered: Resolution[];
	now: Date;
};

/** Fetches one dataset's data for the query client. */
export interface DatasetAdapter {
	/** The catalog dataset id this adapter serves. */
	id: string;
	target(layer: Layer, ctx: AdapterContext): Promise<Target | { unavailable: UnavailableReason }>;
	/** The levels of the entry type's catalog `base` this adapter can actually fetch for `target`. */
	offered(base: Resolution[], target: Target): Resolution[];
	fetch(req: AdapterRequest, ctx: AdapterContext, signal: AbortSignal): Promise<QueryData>;
}

/**
 * The web build's resolver. The server's region API doesn't accept official codes yet, so every
 * region is reported as unresolvable until it does (spec 2, section 9).
 */
export function createWebRegionResolver(): RegionResolver {
	return { resolve: async () => "unsupported" };
}
