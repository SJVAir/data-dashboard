import {
	getLocationsByCode,
	lookupRegionPlace,
	type Location,
	type LocationSource
} from "@sjvair/sdk";
import { untilAborted } from "../metadata";
import type { LocationResolver, PointResolver } from "./registry";

/** The region types a point or a school falls back through, smallest first. */
const FALLBACK_TYPES = ["zipcode", "city", "county"] as const;

/**
 * The location sources `getLocationsByCode` takes. The SDK exports the list only as a type, so
 * it is spelled out here; the `Record` makes the compiler flag a source added to the SDK.
 */
const LOCATION_SOURCES: Record<LocationSource, true> = {
	"cde-public": true,
	"cde-private": true,
	"cdss-ccl": true
};

function isLocationSource(source: string): source is LocationSource {
	return Object.hasOwn(LOCATION_SOURCES, source);
}

/** The most codes one `getLocationsByCode` request takes. */
const MAX_CODES = 100;

type Resolved = Awaited<ReturnType<LocationResolver["resolve"]>>;

type Waiter = { resolve: (found: Resolved) => void; reject: (error: unknown) => void };

function resolvedLocation(location: Location): NonNullable<Resolved> {
	const keys: string[] = [];
	for (const type of FALLBACK_TYPES) {
		const ref = location.regions[type];
		if (ref) keys.push(`${type}:${ref.external_id}`);
	}
	const found: NonNullable<Resolved> = {
		name: location.name,
		keys,
		details: {
			type: location.type,
			city: location.city_name,
			zip: location.zip,
			address: location.address
		},
		point: { lat: location.point.lat, lon: location.point.lng }
	};
	if (location.retired) {
		const by = location.retired.replaced_by;
		found.retired = {
			since: location.retired.since,
			replacedBy: by && { source: by.source, code: by.external_id }
		};
	}
	return found;
}

/**
 * The web build's location resolver, through `getLocationsByCode`. A code may be a location's own
 * code or one of its aliases; a retired location still resolves; a code the server doesn't know
 * and a source the SDK doesn't know (with no request) are `null`. Codes asked for in the same
 * tick are batched into one request per source (at most 100 codes each), and each code is cached
 * for the resolver's lifetime, including an unknown code's `null`. A failed lookup rejects and is
 * retried on the next call; one caller's abort rejects only that caller.
 */
export function createWebLocationResolver(): LocationResolver {
	const cache = new Map<string, Promise<Resolved>>();
	let pending = new Map<LocationSource, Map<string, Waiter>>();

	async function lookup(source: LocationSource, codes: Map<string, Waiter>) {
		const list = [...codes.keys()];
		const batches: string[][] = [];
		for (let i = 0; i < list.length; i += MAX_CODES) batches.push(list.slice(i, i + MAX_CODES));
		await Promise.all(
			batches.map(async (batch) => {
				try {
					const locations = await getLocationsByCode(source, batch);
					const found = new Map<string, NonNullable<Resolved>>();
					for (const location of locations) {
						const resolved = resolvedLocation(location);
						for (const code of [location.external_id, ...location.aliases]) {
							if (!found.has(code)) found.set(code, resolved);
						}
					}
					for (const code of batch) codes.get(code)!.resolve(found.get(code) ?? null);
				} catch (error) {
					for (const code of batch) {
						cache.delete(`${source}:${code}`);
						codes.get(code)!.reject(error);
					}
				}
			})
		);
	}

	function flush() {
		const batch = pending;
		pending = new Map();
		for (const [source, codes] of batch) void lookup(source, codes);
	}

	return {
		resolve(source, code, signal) {
			if (!isLocationSource(source)) return Promise.resolve(null);
			const key = `${source}:${code}`;
			let found = cache.get(key);
			if (!found) {
				found = new Promise<Resolved>((resolve, reject) => {
					if (pending.size === 0) queueMicrotask(flush);
					let codes = pending.get(source);
					if (!codes) pending.set(source, (codes = new Map()));
					codes.set(code, { resolve, reject });
				});
				// Handled by each caller; this keeps a failure nobody awaits from going unhandled.
				found.catch(() => {});
				cache.set(key, found);
			}
			return untilAborted(found, signal);
		}
	};
}

/** A coordinate rounded as the SDK and the server round it (3 decimals, about 100 m). */
function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

/**
 * The web build's point resolver, through `lookupRegionPlace` (a POST body, so the coordinates
 * never reach a URL). Each rounded point is looked up once and kept in memory only, for the
 * resolver's lifetime; a failed lookup rejects with an error that doesn't name the point and is
 * retried on the next call; one caller's abort rejects only that caller.
 */
export function createWebPointResolver(): PointResolver {
	const cache = new Map<string, Promise<string[]>>();

	async function lookup(lat: number, lon: number): Promise<string[]> {
		const regions = await lookupRegionPlace({ lat, lon, type: [...FALLBACK_TYPES] });
		const keys: string[] = [];
		for (const type of FALLBACK_TYPES) {
			const region = regions.find((r) => r.type === type && r.external_id !== null);
			if (region) keys.push(`${type}:${region.external_id}`);
		}
		return keys;
	}

	return {
		keys(lat, lon, signal) {
			const [x, y] = [round(lat), round(lon)];
			// In memory only: this key never leaves the resolver.
			const key = `${x},${y}`;
			let found = cache.get(key);
			if (!found) {
				found = lookup(x, y).catch(() => {
					cache.delete(key);
					// The SDK's message names only the URL (the body is redacted), but a cause
					// could still carry the request, so the error that travels on is a fresh one.
					throw new Error("Looking up the regions containing a point failed");
				});
				found.catch(() => {});
				cache.set(key, found);
			}
			return untilAborted(found, signal);
		}
	};
}
