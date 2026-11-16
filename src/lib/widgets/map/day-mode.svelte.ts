import type { SnapshotAt } from "$lib/data/snapshot";
import type { WidgetInstance } from "$lib/documents/schema";
import { todayPacific } from "$lib/format";
import {
	changeTileOptions,
	viewerReset,
	type TileOptionsContext
} from "../shared/tile-options.svelte";
import { dayOption, dayStops, openStop, type Stop } from "./days";
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
};

/** "Today" turns over at Pacific midnight: the clock ticks once a minute while a range shows. */
const TICK_MS = 60_000;

/** A stop as a primitive key: its day, or "now". */
const stopKey = (stop: Stop): string => (stop === "now" ? "now" : stop.day);

/** The Pacific date key at epoch ms `at`. */
const todayAt = (at: number): string => todayPacific(new Date(at));

/**
 * A Map tile's days: with a date range, its stops (each day up to today, then Now when the range
 * includes today), the stop showing (the saved `day`, else the last stop), and stepping, which
 * saves the day with the tile (one undo step per run of steps) or, for a viewer, holds it for the
 * visit. Without a range the tile shows now. Its effects run in their own root; call `destroy()`.
 */
export class MapDays {
	readonly #in: MapDaysInput;
	readonly #run = new StepRun();
	readonly #stopEffects: () => void;
	#clock = $state(Date.now());
	/**
	 * A step where it can't be saved or held (Get data's preview): shown over the saved day until
	 * that changes. `over` is the saved day it was taken over.
	 */
	#local = $state.raw<{ value: string | undefined; over: string | undefined } | null>(null);

	/** Today's Pacific date key. */
	readonly today = $derived(todayAt(this.#clock));
	readonly #rangeKey = $derived.by(() => {
		const range = this.#in.widget.data.dateRange;
		return range ? JSON.stringify(range) : "";
	});
	/** The tile has a date range (it steps through days; without one it shows now). */
	readonly ranged = $derived(this.#rangeKey !== "");
	readonly #stopsKey = $derived(
		this.ranged ? JSON.stringify(dayStops(JSON.parse(this.#rangeKey), this.today)) : "[]"
	);
	/** The range's stops; none without a range. */
	readonly stops: Stop[] = $derived(JSON.parse(this.#stopsKey));
	readonly #savedDay = $derived.by(() => this.#in.options.day);
	readonly #dayOption = $derived(
		this.#local && this.#local.over === this.#savedDay ? this.#local.value : this.#savedDay
	);
	/** The stop showing, as a key: a day, `"now"`, or `""` for a range with no stops yet. */
	readonly #atKey = $derived.by(() => {
		if (!this.ranged) return "now";
		const stop = openStop(this.#dayOption, this.stops);
		return stop ? stopKey(stop) : "";
	});
	/** The index of the stop showing; -1 when there are no stops (or no range). */
	readonly index = $derived(this.stops.findIndex((s) => stopKey(s) === this.#atKey));
	/** Now or the day showing; null for a range with no stops yet (nothing to show). */
	readonly at = $derived<SnapshotAt | null>(
		this.#atKey === "" ? null : this.#atKey === "now" ? "now" : { day: this.#atKey }
	);
	/** A day stop shows. */
	readonly onDay = $derived(this.#atKey !== "" && this.#atKey !== "now");
	/**
	 * The neighbouring day stops (one each side), fetched ahead so a step draws at once; from the
	 * Now stop, the day before it.
	 */
	readonly ahead = $derived.by(() => {
		const i = this.index;
		if (i < 0) return [];
		return [this.stops[i - 1], this.stops[i + 1]].flatMap((s) => (s && s !== "now" ? [s.day] : []));
	});

	constructor(input: MapDaysInput) {
		this.#in = input;
		this.#stopEffects = $effect.root(() => {
			$effect(() => {
				if (!this.ranged) return;
				const timer = setInterval(() => (this.#clock = Date.now()), TICK_MS);
				return () => clearInterval(timer);
			});
		});
	}

	/**
	 * The stepper's step to stop `index`. A step that changes the day is saved (the last stop as
	 * missing), folded into the run's undo step when it continues one; a viewer's is held for the
	 * visit (back at the owner's day, forgotten). A step that can't go anywhere is still shown.
	 */
	readonly step = (index: number): void => {
		const stops = this.stops;
		const to = stops[index];
		if (!to || stopKey(to) === this.#atKey) return;
		const { amend } = this.#run.next();
		const value = dayOption(to, stops);
		const { widget, tileOptions: ctx, options, saved } = this.#in;
		const next: MapOptions = { ...options };
		if (value === undefined) delete next.day;
		else next.day = value;
		if (!writable(ctx, widget)) {
			this.#local = { value, over: this.#savedDay };
			return;
		}
		if (ctx?.mode === "view" && value === saved.day) viewerReset(ctx, widget, ["day"]);
		else changeTileOptions(ctx, widget, next, ["day"], { amend });
	};

	/** A slider drag ended: the next step starts a new undo step. */
	readonly dragEnd = (): void => this.#run.end();

	destroy(): void {
		this.#stopEffects();
	}
}

/** Whether a step can be saved (an editable dashboard holding the tile) or held (a viewer's). */
function writable(ctx: TileOptionsContext | undefined, widget: WidgetInstance): boolean {
	if (!ctx) return false;
	if (ctx.mode === "view") return true;
	const session = ctx.session();
	return !!session && !session.readOnly && session.doc.body.widgets.some((w) => w.id === widget.id);
}
