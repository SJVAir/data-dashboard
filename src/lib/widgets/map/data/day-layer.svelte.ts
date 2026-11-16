import { untrack } from "svelte";
import type { NowClient, NowSource, NowState } from "$lib/data/now/client";
import { NowQuery } from "$lib/data/now/now-query.svelte";
import type { SnapshotAt } from "$lib/data/snapshot";
import { switchQueries } from "./switch";

/** How many days are fetched ahead of the one showing. */
export const AHEAD = 2;

type MaybeSource<T> = NowSource<T> | null;

export type DayLayerOptions<T> = {
	/** The source for now or a day; null when nothing loads. May resolve async. */
	sourceFor(at: SnapshotAt): MaybeSource<T> | Promise<MaybeSource<T>>;
	/** Whether the shown query polls, given the day showing and its loaded value. */
	polls(at: SnapshotAt, value: T | undefined, source: NowSource<T> | null): boolean;
};

type Input = { on: boolean; at: SnapshotAt; ahead: readonly string[]; today: string };

/**
 * One data set that follows the day showing: a main query for now or the day, and queries
 * fetching the neighbouring days ahead so a step to one draws at once. The ahead queries never
 * poll. Call `update` from inside an owner's `$effect`; `destroy` when done.
 */
export class DayLayer<T> {
	readonly #now: NowClient;
	readonly #opts: DayLayerOptions<T>;
	readonly #main: NowQuery<T>;
	readonly #ahead: NowQuery<T>[];
	#cancel: (() => void) | null = null;
	#at = $state.raw<SnapshotAt | null>(null);
	#source = $state.raw<MaybeSource<T>>(null);
	#polling = $state(true);
	#stop: () => void;

	constructor(now: NowClient, opts: DayLayerOptions<T>) {
		this.#now = now;
		this.#opts = opts;
		this.#main = new NowQuery<T>(now);
		this.#ahead = Array.from({ length: AHEAD }, () => {
			const query = new NowQuery<T>(now);
			query.setPolling(false);
			return query;
		});
		this.#stop = $effect.root(() => {
			$effect(() => {
				const at = this.#at;
				const on = this.#polling;
				const value = this.#main.state.data;
				const source = this.#source;
				this.#main.setPolling(on && at !== null && opts.polls(at, value, source));
			});
		});
	}

	get state(): NowState<T> {
		return this.#main.state;
	}

	/** The main query's current source, or null. */
	get source(): MaybeSource<T> {
		return this.#source;
	}

	get failed(): boolean {
		return this.#main.state.status === "error";
	}

	update(input: Input): void {
		this.#cancel?.();
		this.#cancel = null;
		const { on, at, ahead } = input;
		if (!on) {
			untrack(() => {
				this.#at = null;
				this.#source = null;
				this.#main.set(null);
				for (const query of this.#ahead) query.set(null);
			});
			return;
		}
		// `today` is only a trigger: the caller's `sourceFor` keys now's source by it.
		const results = [
			this.#opts.sourceFor(at),
			...this.#ahead.map((_, i) => (ahead[i] ? this.#opts.sourceFor({ day: ahead[i] }) : null))
		];
		const apply = (found: MaybeSource<T>[]) =>
			untrack(() => {
				this.#at = at;
				this.#source = found[0] ?? null;
				switchQueries<T>(this.#now, [
					[this.#main, found[0] ?? null],
					...this.#ahead.map((query, i): [NowQuery<T>, MaybeSource<T>] => [
						query,
						found[i + 1] ?? null
					])
				]);
			});
		if (results.some((r) => r instanceof Promise)) {
			let cancelled = false;
			this.#cancel = () => (cancelled = true);
			void Promise.all(results).then((found) => {
				if (!cancelled) apply(found);
			});
		} else {
			apply(results as MaybeSource<T>[]);
		}
	}

	setPolling(on: boolean): void {
		this.#polling = on;
	}

	retry(): void {
		this.#main.retry();
	}

	destroy(): void {
		this.#cancel?.();
		this.#cancel = null;
		this.#stop();
		this.#main.destroy();
		for (const query of this.#ahead) query.destroy();
	}
}
