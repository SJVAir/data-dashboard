/**
 * A run of day steps (holding an arrow, dragging the slider): the first step is an undo step,
 * the ones that follow within `windowMs` of the last are folded into it.
 */
export class StepRun {
	readonly #windowMs: number;
	readonly #now: () => number;
	#last: number | null = null;

	constructor(windowMs = 1000, now: () => number = () => Date.now()) {
		this.#windowMs = windowMs;
		this.#now = now;
	}

	/** Counts a step: `amend` is true when it continues the run. */
	next(): { amend: boolean } {
		const now = this.#now();
		const amend = this.#last !== null && now - this.#last <= this.#windowMs;
		this.#last = now;
		return { amend };
	}

	/** Closes the run (a slider drag's end): the next step starts a new one. */
	end(): void {
		this.#last = null;
	}
}
