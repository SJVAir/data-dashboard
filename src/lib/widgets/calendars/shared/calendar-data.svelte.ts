import { untrack } from "svelte";
import { getMetadata } from "$lib/data";
import type { DailyFigure, Level } from "$lib/data/metadata";
import type { QueryState } from "$lib/data/types";
import type { WidgetInstance } from "$lib/documents/schema";
import { CALENDAR_DEFAULT_RANGES, calendarInput } from "$lib/calendars/input";
import { dayStates, type DayState } from "$lib/calendars/day-state";
import type { Selectable } from "$lib/calendars/selection";
import { addDays, todayPacific } from "$lib/format";
import { resolveRange } from "$lib/format/range";
import { m } from "$lib/paraglide/messages.js";
import { resolveThreshold } from "$lib/thresholds/levels";
import { DEFAULT_RANGE } from "../../defaults";
import { DataWidget } from "../../shared/data-widget.svelte";
import { mainLayer } from "../../shared/input";

/** What the day's figure is called: the server's label, else "Daily value". */
export function figureName(figure: DailyFigure | null): string {
	return figure?.label ?? m.calendar_daily_value();
}

/** The figure lookup for one entry type, once it has settled (`null`: none, or it failed). */
type FigureLookup = { entryType: string; figure: DailyFigure | null };

/**
 * A calendar widget's state: its daily query (asking for the figure the metadata names), the
 * state of each day in the range, and its threshold. Call during component initialization.
 */
export class CalendarData {
	readonly #w: DataWidget;
	#lookup = $state.raw<FigureLookup | undefined>();
	/** The clock "today" is read from: ticks each minute and on each data refresh. */
	#now = $state(Date.now());

	readonly figure: DailyFigure | null;
	readonly today: string;
	readonly range: { first: string; last: string };
	/** The days a viewer can pick, or `null` when the range has none (it's all still to come). */
	readonly selectable: Selectable | null;
	readonly levels: Level[];
	/** The query's state, held as loading while the figure lookup is out. */
	readonly shown: QueryState;
	readonly states: Map<string, DayState>;
	/** The level marked and counted; `null` when Off, or when the stored level isn't on the scale. */
	readonly threshold: Level | null;
	/** The stored level isn't on the pollutant's scale: nothing is marked (with a note). */
	readonly thresholdMissing: boolean;

	constructor(widget: () => WidgetInstance) {
		const metadata = getMetadata();
		this.#w = new DataWidget(() => widget(), 1, {
			input: (data, catalog) => {
				const layer = mainLayer(data, catalog);
				const input = calendarInput(data, catalog, widget().type);
				const lookup = this.#lookup;
				// The query waits for the figure, so it runs once with the right key.
				if (!input || !layer?.entryType || lookup?.entryType !== layer.entryType) {
					return { layer, input: null, hidden: 0 };
				}
				const full = lookup.figure ? { ...input, dailyFigure: lookup.figure.field } : input;
				return { layer, input: full, hidden: 0 };
			}
		});
		const w = this.#w;

		const entryType = $derived(mainLayer(widget().data, w.catalog)?.entryType);
		$effect(() => {
			const id = entryType;
			if (!id) return;
			const abort = new AbortController();
			metadata.dailyFigure(id, abort.signal).then(
				(figure) => {
					if (!abort.signal.aborted) this.#lookup = { entryType: id, figure };
				},
				() => {
					if (!abort.signal.aborted) this.#lookup = { entryType: id, figure: null };
				}
			);
			return () => abort.abort();
		});

		$effect(() => {
			const timer = setInterval(() => (this.#now = Date.now()), 60_000);
			return () => clearInterval(timer);
		});
		// Each refresh of the data is also a fresh look at the clock.
		$effect(() => {
			const s = w.shown;
			void ("data" in s ? s.data?.fetchedAt : undefined);
			untrack(() => (this.#now = Date.now()));
		});

		// `$derived.by`: a plain `$derived(…)` reading `this.#lookup` here stays stale (Svelte 5).
		const lookup = $derived.by(() => {
			const l = this.#lookup;
			return entryType && l?.entryType === entryType ? l : undefined;
		});
		const settled = $derived(!!lookup);
		this.figure = $derived(lookup?.figure ?? null);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a fresh read, never mutated
		this.today = $derived(todayPacific(new Date(this.#now)));
		// The range's dates as strings first, so the objects below (and every cell reading them)
		// only change when a date does, not on each minute's tick.
		const rangeKey = $derived.by(() => {
			const spec =
				widget().data.dateRange ?? CALENDAR_DEFAULT_RANGES[widget().type] ?? DEFAULT_RANGE;
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a fresh read, never mutated
			const r = resolveRange(spec, new Date(this.#now));
			return `${r.firstDate}/${r.lastDate}`;
		});
		const first = $derived(rangeKey.slice(0, 10));
		const last = $derived(rangeKey.slice(11));
		this.range = $derived({ first, last });
		const selectableLast = $derived(last < this.today ? last : this.today);
		this.selectable = $derived(first <= selectableLast ? { first, last: selectableLast } : null);
		this.levels = $derived(w.levelList);

		this.shown = $derived.by(() => {
			const s = w.shown;
			const placed = !!w.picked.layer?.place || !!w.picked.layer?.selection;
			if (s.status === "idle" && placed && entryType && !settled) return { status: "loading" };
			return s;
		});

		const dates = $derived.by(() => {
			const out: string[] = [];
			for (let d = this.range.first; d <= this.range.last; d = addDays(d, 1)) out.push(d);
			return out;
		});
		this.states = $derived.by(() => {
			const s = this.shown;
			const data = "data" in s ? s.data : undefined;
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- replaced whole, never mutated
			if (!data) return new Map<string, DayState>();
			return dayStates({
				points: data.series[0]?.points ?? [],
				dates,
				today: this.today,
				figure: this.figure,
				levels: this.levels
			});
		});

		const resolved = $derived(resolveThreshold(widget().thresholds, this.levels));
		this.threshold = $derived(resolved && !resolved.fellBack ? resolved.level : null);
		this.thresholdMissing = $derived(!!resolved?.fellBack);
	}

	get catalog() {
		return this.#w.catalog;
	}

	/** The layer's catalog entry type and dataset (units, precision). */
	get meta() {
		return this.#w.meta;
	}

	get retired() {
		return this.#w.retired;
	}

	/** Whether the levels have loaded (an empty list then means the scale has none). */
	get levelsLoaded(): boolean {
		return Array.isArray(this.#w.levels);
	}

	retry = (): void => this.#w.retry();
}
