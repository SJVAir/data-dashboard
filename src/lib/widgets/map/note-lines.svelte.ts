import type { FeatureCollection, Geometry } from "geojson";
import type { MapFeatureProperties } from "@sjvair/map-sdk/data";
import type { MetadataSource, MonitorTypeInfo } from "$lib/data/metadata";
import { formatNumber } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import { hiddenMarks, hiddenReasonLines, hiddenReasons } from "./marks";
import { monitorIds } from "./sources";

/** The stand-in while the places aren't known; never mutated. */
const NO_PLACES: ReadonlySet<string> = new Set();

/** What the map's notes read from the tile; each field read on its own. */
export interface NoteLinesInput {
	/** The monitors drawn now; null until they have loaded. */
	readonly monitors: FeatureCollection<Geometry, MapFeatureProperties> | null;
	readonly marks: readonly string[];
	readonly entryType: string | undefined;
	readonly entryLabel: string | undefined;
	readonly inPlaces: ReadonlySet<string> | null;
	readonly dayDrawn: ReadonlySet<string> | undefined;
	readonly dayUnrated: boolean;
	readonly dayNoFigures: boolean;
}

/** The map's notes: the day's, then why marks are hidden. No effects. */
export class MapNoteLines {
	readonly #input: NoteLinesInput;
	// Every monitor the server lists and the types' reported pollutants, for the hidden marks'
	// reasons; null while loading or when they can't be loaded (the plain wording then).
	#monitorList = $state.raw<ReadonlyMap<string, { type: string }> | null>(null);
	#monitorTypes = $state.raw<MonitorTypeInfo[] | null>(null);
	// Whether both lookups have settled (either way); the note waits for it so its reasons don't
	// change once they are on screen.
	#lookupsSettled = $state(false);

	constructor(input: NoteLinesInput, metadata: Pick<MetadataSource, "monitors" | "monitorTypes">) {
		this.#input = input;
		void Promise.allSettled([
			metadata.monitors().then(
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- replaced whole, never mutated
				(list) => (this.#monitorList = new Map(list.map((x) => [x.id, x]))),
				() => (this.#monitorList = null)
			),
			metadata.monitorTypes().then(
				(types) => (this.#monitorTypes = types),
				() => (this.#monitorTypes = null)
			)
		]).then(() => (this.#lookupsSettled = true));
	}

	/** The marked monitors not drawn now; none until the monitors for now have loaded. */
	readonly #hidden = $derived.by(() => {
		const features = this.#input.monitors;
		return features ? hiddenMarks(this.#input.marks, monitorIds(features)) : [];
	});

	/** Whether a type reports the pollutant drawn; undefined when that isn't known. */
	#reports = (type: string): boolean | undefined => {
		const entryType = this.#input.entryType;
		const info = this.#monitorTypes?.find((t) => t.type === type);
		if (!info || !entryType) return undefined;
		return info.published.includes(entryType) || (info.unflagged?.includes(entryType) ?? false);
	};

	/** One line per reason the marks are hidden, in order. */
	readonly #hiddenLines = $derived.by(() => {
		if (!this.#hidden.length || !this.#lookupsSettled) return [];
		const input = this.#input;
		const reasons = hiddenReasons(
			this.#hidden,
			this.#monitorList && this.#monitorTypes ? this.#monitorList : null,
			this.#reports,
			input.inPlaces ?? NO_PLACES,
			input.dayDrawn
		);
		const entryLabel = input.entryLabel;
		return hiddenReasonLines(reasons, entryLabel).map(({ reason, count }) => {
			const counted = { count: formatNumber(count), countValue: count };
			return reason === "day"
				? m.map_marks_hidden_day(counted)
				: m.map_marks_hidden({ reason, pollutant: entryLabel ?? "", ...counted });
		});
	});

	/** On a day stop, once: the pollutant's days can't be rated (its scale has no daily figure). */
	readonly #unratedLine = $derived.by(() => {
		const entryLabel = this.#input.entryLabel;
		return this.#input.dayUnrated && entryLabel ? m.map_day_unrated({ pollutant: entryLabel }) : "";
	});
	/** On a day stop that has loaded: no monitor in the places has a figure that day. */
	readonly #noFiguresLine = $derived.by(() =>
		this.#input.dayNoFigures ? m.map_day_no_figures() : ""
	);

	/** The map's notes: the day's, then why marks are hidden. */
	readonly lines: string[] = $derived(
		[this.#unratedLine, this.#noFiguresLine, ...this.#hiddenLines].filter(Boolean)
	);
	/** The notes as one text, for the map's list and its name. */
	readonly text: string = $derived(
		this.lines.reduce(
			(all, line) => (all ? m.sentence_join({ first: all, second: line }) : line),
			""
		)
	);
}
