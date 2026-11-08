import type { ActivitySource } from "$lib/platform/types";
import { startPoller, type Pollable } from "../query/poller";

/** One piece of "now" data that is not a series: a forecast, today's heat, an alert value. */
export type NowSource<T> = {
	/** Cache key; equal keys share one fetch. */
	key: string;
	/** Poller cadence: every 3 minutes (`raw`), or at :55 past each Pacific hour (`hour`). */
	cadence: "raw" | "hour";
	fetch(signal: AbortSignal): Promise<T>;
};

export type NowState<T> =
	| { status: "idle" | "loading"; data?: T }
	| { status: "ready"; data: T; fetchedAt: number }
	| { status: "error"; error: unknown; data?: T };

export interface NowSubscription {
	setPolling(on: boolean): void;
	/** Fetch again after an error (or any time), unless a fetch is already in flight. */
	retry(): void;
	unsubscribe(): void;
}

export interface NowClient extends Pollable {
	subscribe<T>(source: NowSource<T>, listener: (s: NowState<T>) => void): NowSubscription;
}

/** Idle entries are dropped once their last fetch is this old. */
const IDLE_TTL_MS = 60 * 60_000;

type Sub = { listener: (s: NowState<unknown>) => void; polling: boolean };

type Entry = {
	source: NowSource<unknown>;
	subs: Set<Sub>;
	state: NowState<unknown>;
	data?: unknown;
	fetchedAt?: number;
	failed: boolean;
	controller?: AbortController;
};

export function createNowClient(
	opts: { activity?: ActivitySource; now?: () => Date } = {}
): NowClient {
	const now = opts.now ?? (() => new Date());
	const entries = new Map<string, Entry>();
	const changeListeners = new Set<() => void>();

	const changed = () => changeListeners.forEach((l) => l());

	function emit(e: Entry, state: NowState<unknown>) {
		e.state = state;
		for (const s of [...e.subs]) s.listener(state);
	}

	function evictIdle() {
		const at = now().getTime();
		for (const [key, e] of entries) {
			if (e.subs.size === 0 && !e.controller && at - (e.fetchedAt ?? 0) > IDLE_TTL_MS)
				entries.delete(key);
		}
	}

	function run(e: Entry) {
		if (e.controller) return;
		const controller = new AbortController();
		e.controller = controller;
		emit(e, { status: "loading", ...(e.data !== undefined && { data: e.data }) });
		changed();
		e.source.fetch(controller.signal).then(
			(data) => {
				if (e.controller !== controller) return;
				e.controller = undefined;
				e.data = data;
				e.fetchedAt = now().getTime();
				e.failed = false;
				emit(e, { status: "ready", data, fetchedAt: e.fetchedAt });
				changed();
			},
			(error) => {
				if (e.controller !== controller) return;
				e.controller = undefined;
				e.failed = true;
				emit(e, { status: "error", error, ...(e.data !== undefined && { data: e.data }) });
				changed();
			}
		);
	}

	const client: NowClient = {
		subscribe<T>(source: NowSource<T>, listener: (s: NowState<T>) => void): NowSubscription {
			evictIdle();
			let e = entries.get(source.key);
			if (!e) {
				e = {
					source: source as NowSource<unknown>,
					subs: new Set(),
					state: { status: "idle" },
					failed: false
				};
				entries.set(source.key, e);
			}
			const entry = e;
			const sub: Sub = { listener: listener as Sub["listener"], polling: true };
			entry.subs.add(sub);
			if (entry.state.status !== "idle") sub.listener(entry.state);
			if (!entry.controller && entry.fetchedAt === undefined) run(entry);
			else changed();
			return {
				setPolling(on) {
					sub.polling = on;
					changed();
				},
				retry() {
					run(entry);
				},
				unsubscribe() {
					if (!entry.subs.delete(sub)) return;
					if (entry.subs.size === 0 && entry.controller) {
						const c = entry.controller;
						entry.controller = undefined;
						c.abort();
						entry.state =
							entry.data !== undefined
								? { status: "ready", data: entry.data, fetchedAt: entry.fetchedAt ?? 0 }
								: { status: "idle" };
					}
					changed();
				}
			};
		},
		refetch(key) {
			const e = entries.get(key);
			if (e) run(e);
		},
		entries() {
			return [...entries].map(([key, e]) => ({
				key,
				subscribers: e.subs.size,
				inFlight: !!e.controller,
				fetchedAt: e.fetchedAt,
				includesNow: true,
				resolution: e.source.cadence,
				polling: [...e.subs].some((s) => s.polling),
				failed: e.failed
			}));
		},
		onChange(listener) {
			changeListeners.add(listener);
			return () => changeListeners.delete(listener);
		}
	};

	if (opts.activity) startPoller(client, opts.activity, { now });
	return client;
}
