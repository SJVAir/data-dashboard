import { getRegionsByCode, getRegionsMeta, type RegionType } from "@sjvair/sdk";
import { regionDisplayName } from "@sjvair/sdk/regions";
import type { ResolvedRange } from "$lib/format/range";
import { untilAborted, type EntryTypeMeta, type MetadataSource } from "../metadata";
import type { Layer, PesticideFilters, Resolution } from "../schema";
import type { QueryData, Target, UnavailableReason } from "../types";

/** A region found on the server: its sqid, name, and (when retired) the retirement marker. */
export type ResolvedRegion = {
	/** The server's sqid. */
	id: string;
	name: string;
	retired?: { since: string; replacedBy: { type: string; code: string } | null };
};

/** Looks up a region from its document reference; `null` when there is none. */
export interface RegionResolver {
	resolve(
		type: string,
		code: string,
		signal?: AbortSignal
	): Promise<ResolvedRegion | "unsupported" | null>;
}

/**
 * Looks up a school or other location from its document reference: its name, the region keys it
 * falls back through (`"zipcode:…"`, `"city:…"`, `"county:…"`, in that order, only those it has),
 * and (when retired) the retirement marker; `null` when there is none.
 */
export interface LocationResolver {
	resolve(
		source: string,
		code: string,
		signal?: AbortSignal
	): Promise<{
		name: string;
		keys: string[];
		/** What a place picker row shows: its type (`regions/meta/` `location_types`) and where. */
		details?: { type: string; city: string; zip: string; address: string };
		/** Where the place is (never put in a URL, log, or error message). */
		point?: { lat: number; lon: number };
		retired?: { since: string; replacedBy: { source: string; code: string } | null };
	} | null>;
}

/**
 * The region keys containing a point, in the same order as a location's; none when it's outside
 * them all. Implementations never put the coordinates in a URL, a log, or an error message.
 */
export interface PointResolver {
	keys(lat: number, lon: number, signal?: AbortSignal): Promise<string[]>;
}

export type AdapterContext = {
	metadata: MetadataSource;
	regions: RegionResolver;
	locations: LocationResolver;
	points: PointResolver;
};

export type AdapterRequest = {
	entryType: string;
	target: Target;
	resolution: Resolution;
	downsampleFromRaw: boolean;
	/** Attach each day point's worst hourly average (set only where it applies). */
	worstHour: boolean;
	/** The summary field each day point reads as `figure` (honored at resolution `"day"`). */
	dailyFigure?: string;
	range: ResolvedRange;
	/** The levels this adapter can fetch for `target` (see `DatasetAdapter.offered`). */
	offered: Resolution[];
	now: Date;
	/** The layer's weather station, when it has one. */
	station?: string;
	/** The layer's pesticide filters, when it has any. */
	filters?: PesticideFilters;
};

/** Fetches one dataset's data for the query client. */
export interface DatasetAdapter {
	/** The catalog dataset id this adapter serves. */
	id: string;
	target(layer: Layer, ctx: AdapterContext): Promise<Target | { unavailable: UnavailableReason }>;
	/** The levels of the entry type's catalog `base` this adapter can actually fetch for `target`. */
	offered(base: Resolution[], target: Target): Resolution[];
	/**
	 * Whether a non-pollutant entry type can be an overlay on the main layer (fetched for the main
	 * layer's places at its detail). Absent: none can.
	 */
	overlays?: (entry: EntryTypeMeta) => boolean;
	fetch(req: AdapterRequest, ctx: AdapterContext, signal: AbortSignal): Promise<QueryData>;
}

type CodedRegionType = Exclude<RegionType, "land_use">;

/**
 * The region types `getRegionsByCode` looks up. The SDK exports the list only as a type, so it is
 * spelled out here; the `Record` makes the compiler flag a type added to or dropped from the SDK.
 */
const CODED_REGION_TYPES: Record<CodedRegionType, true> = {
	county: true,
	city: true,
	zipcode: true,
	tract: true,
	cdp: true,
	congressional_district: true,
	state_assembly: true,
	state_senate: true,
	school_district: true,
	air_district: true,
	urban_area: true,
	protected: true,
	ab617: true,
	place: true,
	mtrs: true,
	custom: true
};

function isCodedRegionType(type: string): type is CodedRegionType {
	return Object.hasOwn(CODED_REGION_TYPES, type);
}

/** The most codes `getRegionsByCode` takes at once. */
const MAX_CODES = 100;

type Waiter = {
	resolve: (region: ResolvedRegion | null) => void;
	reject: (error: unknown) => void;
};

/**
 * The web build's resolver: official codes to region sqids through `getRegionsByCode`. A retired
 * region still resolves; a code the server doesn't know is `null`; land-use regions (which have no
 * codes) and types the SDK doesn't know are `"unsupported"`, with no request. Codes asked for in
 * the same tick are batched into one request per type, and each code is cached for the resolver's
 * lifetime, including an unknown code's `null`: a region added on the server later resolves only
 * after a reload (a new resolver). A failed lookup rejects and is retried on the
 * next call. The shared request carries no caller's signal, so one caller's abort rejects only
 * that caller.
 */
export function createWebRegionResolver(): RegionResolver {
	const cache = new Map<string, Promise<ResolvedRegion | null>>();
	let pending = new Map<string, Map<string, Waiter>>();
	// One regions/meta fetch per resolver (a failure is forgotten and retried).
	let metaRequest: ReturnType<typeof getRegionsMeta> | null = null;
	function regionsMeta() {
		const request = (metaRequest ??= getRegionsMeta());
		request.catch(() => {
			if (metaRequest === request) metaRequest = null;
		});
		return request;
	}

	async function lookup(type: string, codes: Map<string, Waiter>) {
		const list = [...codes.keys()];
		const batches: string[][] = [];
		for (let i = 0; i < list.length; i += MAX_CODES) batches.push(list.slice(i, i + MAX_CODES));
		await Promise.all(
			batches.map(async (batch) => {
				try {
					const [regions, meta] = await Promise.all([
						getRegionsByCode(type as CodedRegionType, batch),
						regionsMeta()
					]);
					const found = new Map<string, ResolvedRegion>();
					for (const r of regions) {
						if (r.external_id === null) continue;
						const region: ResolvedRegion = {
							id: r.id,
							name: regionDisplayName(r, meta)
						};
						if (r.retired) {
							region.retired = {
								since: r.retired.since,
								replacedBy: r.retired.replaced_by && {
									type: r.retired.replaced_by.type,
									code: r.retired.replaced_by.external_id
								}
							};
						}
						found.set(r.external_id, region);
					}
					for (const code of batch) codes.get(code)!.resolve(found.get(code) ?? null);
				} catch (error) {
					for (const code of batch) {
						cache.delete(`${type}:${code}`);
						codes.get(code)!.reject(error);
					}
				}
			})
		);
	}

	function flush() {
		const batch = pending;
		pending = new Map();
		for (const [type, codes] of batch) void lookup(type, codes);
	}

	return {
		resolve(type, code, signal) {
			if (!isCodedRegionType(type)) return Promise.resolve("unsupported");
			const key = `${type}:${code}`;
			let id = cache.get(key);
			if (!id) {
				id = new Promise<ResolvedRegion | null>((resolve, reject) => {
					if (pending.size === 0) queueMicrotask(flush);
					let codes = pending.get(type);
					if (!codes) pending.set(type, (codes = new Map()));
					codes.set(code, { resolve, reject });
				});
				// Handled by each caller; this keeps a failure nobody awaits from going unhandled.
				id.catch(() => {});
				cache.set(key, id);
			}
			return untilAborted(id, signal);
		}
	};
}
