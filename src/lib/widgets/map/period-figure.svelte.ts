import type { MetadataSource } from "$lib/data/metadata";
import type { MapLevel } from "./days";

/** What the period's figure lookup reads from the tile; each field read on its own. */
export interface PeriodFigureInput {
	/** The pollutant drawn. */
	readonly entryType: string | undefined;
	/** The level the stops step by (Daily, Monthly or Yearly). */
	readonly resolution: MapLevel;
	/** Whether the tile has a range of stops. */
	readonly ranged: boolean;
	/** Whether the tile shows a stop of its range (a day, month or year; not now). */
	readonly onDay: boolean;
}

/**
 * The name of the pollutant's figure at the stops' resolution, for the monitors on a stop: on a
 * day the daily figure's (`daily_statistic_label`, e.g. "24-hour average"), on a month or year the
 * period figure's (`period_statistic_label`, e.g. "Average of 24-hour averages"). Its effect runs
 * in its own root; call `destroy()`.
 */
export class MapPeriodFigure {
	readonly #input: PeriodFigureInput;
	/** The name looked up, and for which pollutant and level; undefined when the scale names none. */
	#looked = $state<{ for: string; label: string | undefined } | null>(null);
	readonly #for = $derived.by(() => {
		const type = this.#input.entryType;
		return type ? `${type}|${this.#input.resolution}` : undefined;
	});
	readonly #stop: () => void;

	constructor(input: PeriodFigureInput, metadata: Pick<MetadataSource, "figure">) {
		this.#input = input;
		this.#stop = $effect.root(() => {
			// Looked up for any ranged tile (on its Now stop too), so a step to a day knows it already.
			$effect(() => {
				const key = this.#for;
				const type = this.#input.entryType;
				const resolution = this.#input.resolution;
				if (!key || !type || !this.#input.ranged || this.#looked?.for === key) return;
				const controller = new AbortController();
				const settle = (label: string | undefined) => {
					if (!controller.signal.aborted) this.#looked = { for: key, label };
				};
				metadata.figure(type, resolution, controller.signal).then(
					(figure) => settle(figure?.label ?? undefined),
					// Without it the monitors keep their interval note: nothing to show or report here.
					() => settle(undefined)
				);
				return () => controller.abort();
			});
		});
	}

	/** Whether the figure's name is known for the pollutant and level drawn (or isn't needed). */
	readonly settled: boolean = $derived.by(() => {
		return !this.#input.onDay || this.#looked?.for === this.#for;
	});
	/** On a stop, what the monitors' figure is ("24-hour average"); unset on now. */
	readonly label: string | undefined = $derived.by(() => {
		return this.#input.onDay && this.#looked && this.#looked.for === this.#for
			? this.#looked.label
			: undefined;
	});

	destroy(): void {
		this.#stop();
	}
}
