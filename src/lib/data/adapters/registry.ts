import { getRegionsByCode } from "@sjvair/sdk";
import type { ResolvedRange } from "$lib/format/range";
import { untilAborted, type MetadataSource } from "../metadata";
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

/** The most codes `getRegionsByCode` takes at once. */
const MAX_CODES = 100;

type Waiter = { resolve: (id: string | null) => void; reject: (error: unknown) => void };

/**
 * The web build's resolver: official codes to region sqids through `getRegionsByCode`. A retired
 * region still resolves; a code the server doesn't know is `null`; land-use regions have no codes
 * (`"unsupported"`). Codes asked for in the same tick are batched into one request per type, and
 * each code is cached for the resolver's lifetime. A failed lookup rejects and is retried on the
 * next call. The shared request carries no caller's signal, so one caller's abort rejects only
 * that caller.
 */
export function createWebRegionResolver(): RegionResolver {
	const cache = new Map<string, Promise<string | null>>();
	let pending = new Map<string, Map<string, Waiter>>();

	async function lookup(type: string, codes: Map<string, Waiter>) {
		const list = [...codes.keys()];
		const batches: string[][] = [];
		for (let i = 0; i < list.length; i += MAX_CODES) batches.push(list.slice(i, i + MAX_CODES));
		await Promise.all(
			batches.map(async (batch) => {
				try {
					const regions = await getRegionsByCode(
						type as Parameters<typeof getRegionsByCode>[0],
						batch
					);
					const ids = new Map(regions.map((r) => [r.external_id, r.id]));
					for (const code of batch) codes.get(code)!.resolve(ids.get(code) ?? null);
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
			if (type === "land_use") return Promise.resolve("unsupported");
			const key = `${type}:${code}`;
			let id = cache.get(key);
			if (!id) {
				id = new Promise<string | null>((resolve, reject) => {
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
