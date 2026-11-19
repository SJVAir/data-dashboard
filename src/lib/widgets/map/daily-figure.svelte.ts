import type { MetadataSource } from "$lib/data/metadata";

/** What the daily figure's lookup reads from the tile; each field read on its own. */
export interface DailyFigureInput {
	/** The pollutant drawn. */
	readonly entryType: string | undefined;
	/** Whether the tile has a range of days. */
	readonly ranged: boolean;
	/** Whether the tile shows a day stop (not now). */
	readonly onDay: boolean;
}

/**
 * The pollutant's daily figure's name (`daily_statistic_label`, e.g. "24-hour average"), for the
 * monitors on a day stop. Its effect runs in its own root; call `destroy()`.
 */
export class MapDailyFigure {
	readonly #input: DailyFigureInput;
	/** The name looked up, and for which pollutant; undefined when the scale names none. */
	#looked = $state<{ for: string; label: string | undefined } | null>(null);
	readonly #stop: () => void;

	constructor(input: DailyFigureInput, metadata: Pick<MetadataSource, "figure">) {
		this.#input = input;
		this.#stop = $effect.root(() => {
			// Looked up for any ranged tile (on its Now stop too), so a step to a day knows it already.
			$effect(() => {
				const type = this.#input.entryType;
				if (!type || !this.#input.ranged || this.#looked?.for === type) return;
				const controller = new AbortController();
				const settle = (label: string | undefined) => {
					if (!controller.signal.aborted) this.#looked = { for: type, label };
				};
				metadata.figure(type, "day", controller.signal).then(
					(figure) => settle(figure?.label ?? undefined),
					// Without it the monitors keep their interval note: nothing to show or report here.
					() => settle(undefined)
				);
				return () => controller.abort();
			});
		});
	}

	/** Whether the figure's name is known for the pollutant drawn (or isn't needed: on now). */
	readonly settled: boolean = $derived.by(() => {
		return !this.#input.onDay || this.#looked?.for === this.#input.entryType;
	});
	/** On a day stop, what the monitors' figure is ("24-hour average"); unset on now. */
	readonly label: string | undefined = $derived.by(() => {
		return this.#input.onDay && this.#looked && this.#looked.for === this.#input.entryType
			? this.#looked.label
			: undefined;
	});

	destroy(): void {
		this.#stop();
	}
}
