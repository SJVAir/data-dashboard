import type { QueryClient, Subscription } from "./query/client";
import type { QueryInput, QueryState } from "./types";

/**
 * One subscriber's query as reactive state, for components. `set` switches the input (the last
 * one wins); `null` means nothing to show, which drops the subscription and reads as loading.
 * Call `destroy` when the component goes away.
 */
export class LiveQuery {
	state = $state<QueryState>({ status: "loading" });
	readonly #client: QueryClient;
	#sub: Subscription | null = null;
	#polling = true;

	constructor(client: QueryClient, input: QueryInput | null) {
		this.#client = client;
		this.set(input);
	}

	set(input: QueryInput | null): void {
		if (!input) {
			this.destroy();
			this.state = { status: "loading" };
		} else if (this.#sub) {
			this.#sub.update(input);
		} else {
			this.#sub = this.#client.subscribe(input, (s) => (this.state = s));
			this.#sub.setPolling(this.#polling);
		}
	}

	/** Whether this query wants its data polled (on by default; off while minimized, say). */
	setPolling(on: boolean): void {
		this.#polling = on;
		this.#sub?.setPolling(on);
	}

	destroy(): void {
		this.#sub?.unsubscribe();
		this.#sub = null;
	}
}
