import type { NowClient, NowSource, NowState, NowSubscription } from "./client";

/**
 * One subscriber's now source as reactive state, for components (like `LiveQuery`). `set`
 * switches the source (the last one wins); `null` drops the subscription and reads as idle.
 * Call `destroy` when the component goes away.
 */
export class NowQuery<T> {
	state = $state.raw<NowState<T>>({ status: "idle" });
	readonly #client: NowClient;
	#sub: NowSubscription | null = null;
	#key: string | null = null;
	#polling = true;

	constructor(client: NowClient, source: NowSource<T> | null = null) {
		this.#client = client;
		this.set(source);
	}

	set(source: NowSource<T> | null): void {
		if (source && this.#sub && source.key === this.#key) return;
		this.destroy();
		this.#key = source?.key ?? null;
		if (!source) {
			this.state = { status: "idle" };
			return;
		}
		this.#sub = this.#client.subscribe(source, (s) => (this.state = s));
		this.#sub.setPolling(this.#polling);
	}

	setPolling(on: boolean): void {
		this.#polling = on;
		this.#sub?.setPolling(on);
	}

	retry(): void {
		this.#sub?.retry();
	}

	destroy(): void {
		this.#sub?.unsubscribe();
		this.#sub = null;
	}
}
