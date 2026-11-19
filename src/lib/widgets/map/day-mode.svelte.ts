import type { SnapshotAt } from "$lib/data/snapshot";
import type { WidgetInstance } from "$lib/documents/schema";
import { todayPacific } from "$lib/format";
import {
	changeTileOptions,
	viewerReset,
	type TileOptionsContext
} from "../shared/tile-options.svelte";
import { openStop, periodStops, stopKey, stopOption, type MapLevel, type Stop } from "./days";
import type { MapOptions } from "./options";
import { StepRun } from "./step-run";

/** What the Map's days read from the widget: an object of getters, each read on its own. */
export type MapDaysInput = {
	readonly widget: WidgetInstance;
	readonly tileOptions: TileOptionsContext | undefined;
	/** The options the tile shows (a viewer's held keys over the saved ones). */
	readonly options: MapOptions;
	/** The owner's options, as saved. */
	readonly saved: MapOptions;
	/** The level the stops step by: the Map's effective resolution (Daily, Monthly or Yearly). */
	readonly resolution: MapLevel;
};

/**
 * "Today" turns over at Pacific midnight: the clock ticks once a minute (a range's stops and
 * the Now stop's day follow it).
 */
const TICK_MS = 60_000;

/** The Pacific date key at epoch ms `at`. */
const todayAt = (at: number): string => todayPacific(new Date(at));

/**
 * A Map tile's stops: with a date range, each period of it at the resolution (`periodStops`: each
 * day up to today then Now; or each month or year, the current one last, so far), the stop showing
 * (the saved `at`, else the last stop), and stepping, which saves the stop with the tile (one undo
 * step per run of steps) or, for a viewer, holds it for the visit. Without a range the tile shows
 * now. Its effects run in their own root; call `destroy()`.
 */
export class MapDays {
	readonly #in: MapDaysInput;
	readonly #run = new StepRun();
	readonly #stopEffects: () => void;
	#clock = $state(Date.now());
	/**
	 * A step where it can't be saved or held (Get data's preview): shown over the saved stop until
	 * that changes. `over` is the saved stop it was taken over.
	 */
	#local = $state.raw<{ value: string | undefined; over: string | undefined } | null>(null);

	/** Today's Pacific date key. */
	readonly today = $derived(todayAt(this.#clock));
	readonly #rangeKey = $derived.by(() => {
		const range = this.#in.widget.data.dateRange;
		return range ? JSON.stringify(range) : "";
	});
	/** The tile has a date range (it steps through its periods; without one it shows now). */
	readonly ranged = $derived(this.#rangeKey !== "");
	/** The level the stops step by. */
	readonly resolution: MapLevel = $derived.by(() => this.#in.resolution);
	readonly #stopsKey = $derived(
		this.ranged
			? JSON.stringify(periodStops(JSON.parse(this.#rangeKey), this.resolution, this.today))
			: "[]"
	);
	/** The range's stops; none without a range. */
	readonly stops: Stop[] = $derived(JSON.parse(this.#stopsKey));
	readonly #savedAt = $derived.by(() => this.#in.options.at);
	readonly #atOption = $derived(
		this.#local && this.#local.over === this.#savedAt ? this.#local.value : this.#savedAt
	);
	/** The stop showing, as a key: a period start, `"now"`, or `""` for a range with no stops yet. */
	readonly #atKey = $derived.by(() => {
		if (!this.ranged) return "now";
		const stop = openStop(this.#atOption, this.stops);
		return stop ? stopKey(stop) : "";
	});
	/** The index of the stop showing; -1 when there are no stops (or no range). */
	readonly index = $derived(this.stops.findIndex((s) => stopKey(s) === this.#atKey));
	/**
	 * Now, the day showing, or the month or year showing (by its start); null for a range with no
	 * stops yet (nothing to show).
	 */
	readonly at = $derived.by<SnapshotAt | null>(() => {
		const key = this.#atKey;
		if (key === "") return null;
		if (key === "now") return "now";
		const level = this.resolution;
		return level === "day" ? { day: key } : { start: key, resolution: level };
	});
	/** A stop of the range shows (a day, month or year; not Now). */
	readonly onDay = $derived(this.#atKey !== "" && this.#atKey !== "now");
	/**
	 * The neighbouring day stops (one each side), fetched ahead so a step draws at once; from the
	 * Now stop, the day before it. None at Monthly or Yearly.
	 */
	readonly ahead = $derived.by(() => {
		const i = this.index;
		if (i < 0 || this.resolution !== "day") return [];
		return [this.stops[i - 1], this.stops[i + 1]].flatMap((s) => (s && s !== "now" ? [s.at] : []));
	});

	constructor(input: MapDaysInput) {
		this.#in = input;
		this.#stopEffects = $effect.root(() => {
			$effect(() => {
				const timer = setInterval(() => (this.#clock = Date.now()), TICK_MS);
				return () => clearInterval(timer);
			});
		});
	}

	/**
	 * The stepper's step to stop `index`. A step that changes the stop is saved (the last stop as
	 * missing), folded into the run's undo step when it continues one (but not after an undo: with
	 * something to redo, the step is its own undo step, which clears redo); a viewer's is held for
	 * the visit (back at the owner's stop, forgotten). A step that can't go anywhere is still shown.
	 */
	readonly step = (index: number): void => {
		const stops = this.stops;
		const to = stops[index];
		if (!to || stopKey(to) === this.#atKey) return;
		const { widget, tileOptions: ctx, options, saved } = this.#in;
		const amend = this.#run.next().amend && !canRedo(ctx);
		const value = stopOption(to, stops);
		const next: MapOptions = { ...options };
		if (value === undefined) delete next.at;
		else next.at = value;
		if (!writable(ctx, widget)) {
			this.#local = { value, over: this.#savedAt };
			return;
		}
		if (ctx?.mode === "view" && value === saved.at) viewerReset(ctx, widget, ["at"]);
		else changeTileOptions(ctx, widget, next, ["at"], { amend });
	};

	/** A slider drag ended: the next step starts a new undo step. */
	readonly dragEnd = (): void => this.#run.end();

	destroy(): void {
		this.#stopEffects();
	}
}

/** Whether the tile's session has an undone step to redo (a step then can't fold into a run). */
function canRedo(ctx: TileOptionsContext | undefined): boolean {
	return ctx?.mode === "edit" && !!ctx.session()?.canRedo;
}

/** Whether a step can be saved (an editable dashboard holding the tile) or held (a viewer's). */
function writable(ctx: TileOptionsContext | undefined, widget: WidgetInstance): boolean {
	if (!ctx) return false;
	if (ctx.mode === "view") return true;
	const session = ctx.session();
	return !!session && !session.readOnly && session.doc.body.widgets.some((w) => w.id === widget.id);
}
