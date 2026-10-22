import { rangeSpanDays, resolveRange } from "$lib/format/range";
import type {
	AdapterContext,
	AdapterRequest,
	DatasetAdapter,
	RegionResolver
} from "../adapters/registry";
import type { MetadataSource } from "../metadata";
import { chooseResolution } from "../resolution";
import type { DateRangeSpec, Resolution } from "../schema";
import type { QueryData, QueryInput, QueryState, UnavailableReason } from "../types";
import { keyRange, queryKey, stableJson } from "./key";

export interface Subscription {
	/** Switch this subscription to a new input; the last input requested wins. */
	update(input: QueryInput): void;
	/** Whether this subscriber wants its entry polled (on by default). */
	setPolling(on: boolean): void;
	unsubscribe(): void;
	/** The cache key this subscription is attached to; `null` while resolving or unavailable. */
	readonly key: string | null;
}

export type QueryEntryInfo = {
	key: string;
	subscribers: number;
	inFlight: boolean;
	fetchedAt?: number;
	includesNow: boolean;
	resolution: Resolution;
	/** Whether any subscriber has polling on. */
	polling: boolean;
};

export interface QueryClient {
	subscribe(input: QueryInput, listener: (s: QueryState) => void): Subscription;
	/** Fetch an entry again with a fresh `now`, unless it is already in flight. */
	refetch(key: string): void;
	entries(): QueryEntryInfo[];
}

export type QueryClientOptions = {
	adapters: DatasetAdapter[];
	metadata: MetadataSource;
	regions: RegionResolver;
	now?: () => Date;
	maxIdleEntries?: number;
};

type Plan = {
	key: string;
	adapter: DatasetAdapter;
	spec: DateRangeSpec;
	request: AdapterRequest;
};

type Entry = {
	key: string;
	adapter: DatasetAdapter;
	spec: DateRangeSpec;
	/** The request last fetched (or being fetched). */
	request: AdapterRequest;
	subscribers: Set<Sub>;
	/** Present while a request is in flight. */
	controller?: AbortController;
	data?: QueryData;
	failed: boolean;
	error?: unknown;
	lastUsed: number;
};

type Sub = {
	listener: (s: QueryState) => void;
	inputJson?: string;
	/** Bumped on every update and on unsubscribe; a resolution pass with an old value is dropped. */
	seq: number;
	entry?: Entry;
	polling: boolean;
	closed: boolean;
};

function entryState(entry: Entry): QueryState {
	const { data, error } = entry;
	if (!entry.controller && entry.failed) {
		return data ? { status: "error", error, data } : { status: "error", error };
	}
	if (!entry.controller && data) return { status: "ready", data };
	return data ? { status: "loading", data } : { status: "loading" };
}

export function createQueryClient(opts: QueryClientOptions): QueryClient {
	const adapters = new Map(opts.adapters.map((a) => [a.id, a]));
	const ctx: AdapterContext = { metadata: opts.metadata, regions: opts.regions };
	const now = opts.now ?? (() => new Date());
	const maxIdleEntries = opts.maxIdleEntries ?? 200;
	const cache = new Map<string, Entry>();
	let clock = 0;

	async function plan(
		input: QueryInput,
		at: Date
	): Promise<Plan | { unavailable: UnavailableReason }> {
		const { layer } = input;
		const catalog = await opts.metadata.catalog();
		if (catalog === "unavailable") return { unavailable: "catalog-unavailable" };
		// Retired datasets and entry types still work ("Stable ids and retirement").
		const dataset = catalog.find((d) => d.id === layer.dataset);
		if (!dataset) return { unavailable: "unknown-dataset" };
		const entryType = dataset.entryTypes.find((e) => e.id === layer.entryType);
		if (!entryType) return { unavailable: "unknown-entry-type" };
		const adapter = adapters.get(dataset.id);
		if (!adapter) return { unavailable: "no-adapter" };

		const target = await adapter.target(layer, ctx);
		if ("unavailable" in target) return target;

		const range = resolveRange(input.dateRange, at);
		const offered = adapter.offered(entryType.resolutions, target);
		let choice;
		try {
			choice = chooseResolution({
				spanDays: rangeSpanDays(range),
				offered,
				pin: input.pin,
				override: layer.resolution
			});
		} catch (error) {
			if (!(error instanceof RangeError)) throw error;
			return { unavailable: target.kind === "all" ? "whole-layer-raw" : "no-resolution" };
		}
		if (target.kind === "all" && (choice.resolution === "raw" || choice.downsampleFromRaw)) {
			return { unavailable: "whole-layer-raw" };
		}

		const { resolution, downsampleFromRaw } = choice;
		const key = queryKey({
			dataset: dataset.id,
			entryType: entryType.id,
			target,
			resolution,
			downsampleFromRaw,
			range: keyRange(input.dateRange, range)
		});
		return {
			key,
			adapter,
			spec: input.dateRange,
			request: {
				entryType: entryType.id,
				target,
				resolution,
				downsampleFromRaw,
				range,
				offered,
				now: at
			}
		};
	}

	function notify(entry: Entry) {
		const state = entryState(entry);
		for (const sub of [...entry.subscribers]) sub.listener(state);
	}

	function fetchEntry(entry: Entry, request: AdapterRequest) {
		const controller = new AbortController();
		entry.controller = controller;
		entry.request = request;
		notify(entry);
		// An aborted or superseded request settles silently: its result is never stored or shown.
		const current = () => entry.controller === controller && !controller.signal.aborted;
		(async () => entry.adapter.fetch(request, ctx, controller.signal))().then(
			(data) => {
				if (!current()) return;
				entry.controller = undefined;
				entry.data = data;
				entry.failed = false;
				entry.error = undefined;
				notify(entry);
			},
			(error) => {
				if (!current()) return;
				entry.controller = undefined;
				entry.failed = true;
				entry.error = error;
				notify(entry);
			}
		);
	}

	/** Absent data, a failed fetch, or a rolling range whose dates have moved since the fetch. */
	function isStale(entry: Entry, request: AdapterRequest): boolean {
		const fetched = entry.request.range;
		return (
			!entry.data ||
			entry.failed ||
			fetched.firstDate !== request.range.firstDate ||
			fetched.lastDate !== request.range.lastDate
		);
	}

	function evict() {
		const idle = [...cache.values()].filter((e) => e.subscribers.size === 0);
		if (idle.length <= maxIdleEntries) return;
		idle.sort((a, b) => a.lastUsed - b.lastUsed);
		for (const entry of idle.slice(0, idle.length - maxIdleEntries)) {
			entry.controller?.abort();
			entry.controller = undefined;
			cache.delete(entry.key);
		}
	}

	function attach(sub: Sub, p: Plan) {
		let entry = cache.get(p.key);
		const created = !entry;
		if (!entry) {
			entry = {
				key: p.key,
				adapter: p.adapter,
				spec: p.spec,
				request: p.request,
				subscribers: new Set(),
				failed: false,
				lastUsed: 0
			};
			cache.set(p.key, entry);
		}
		entry.subscribers.add(sub);
		entry.lastUsed = ++clock;
		sub.entry = entry;
		if (!entry.controller && (created || isStale(entry, p.request))) {
			fetchEntry(entry, p.request);
		} else {
			sub.listener(entryState(entry));
		}
		evict();
	}

	function detach(sub: Sub) {
		const entry = sub.entry;
		if (!entry) return;
		sub.entry = undefined;
		entry.subscribers.delete(sub);
		if (entry.subscribers.size > 0) return;
		entry.lastUsed = ++clock;
		if (entry.controller) {
			entry.controller.abort();
			entry.controller = undefined;
		}
		// Without data an idle entry is worth nothing (its fetch was aborted or failed).
		if (!entry.data) cache.delete(entry.key);
		evict();
	}

	function request(sub: Sub, input: QueryInput) {
		const json = stableJson(input);
		if (json === sub.inputJson) return;
		sub.inputJson = json;
		const seq = ++sub.seq;
		detach(sub);
		sub.listener({ status: "loading" });

		const at = now();
		const live = () => sub.seq === seq && !sub.closed;
		plan(input, at).then(
			(p) => {
				if (!live()) return;
				if ("unavailable" in p) sub.listener({ status: "unavailable", reason: p.unavailable });
				else attach(sub, p);
			},
			(error) => {
				if (live()) sub.listener({ status: "error", error });
			}
		);
	}

	return {
		subscribe(input, listener) {
			const sub: Sub = { listener, seq: 0, polling: true, closed: false };
			request(sub, input);
			return {
				update(next) {
					if (!sub.closed) request(sub, next);
				},
				setPolling(on) {
					sub.polling = on;
				},
				unsubscribe() {
					if (sub.closed) return;
					sub.closed = true;
					sub.seq++;
					detach(sub);
				},
				get key() {
					return sub.entry?.key ?? null;
				}
			};
		},

		refetch(key) {
			const entry = cache.get(key);
			if (!entry || entry.controller) return;
			const at = now();
			fetchEntry(entry, { ...entry.request, range: resolveRange(entry.spec, at), now: at });
		},

		entries() {
			return [...cache.values()].map((e) => ({
				key: e.key,
				subscribers: e.subscribers.size,
				inFlight: !!e.controller,
				fetchedAt: e.data?.fetchedAt,
				includesNow: e.request.range.includesNow,
				resolution: e.request.resolution,
				polling: [...e.subscribers].some((s) => s.polling)
			}));
		}
	};
}
