/**
 * Current conditions' pollutants: one air-quality layer per pollutant, in the order chosen, the
 * first holding the searched monitor, and one alert level per pollutant (`entryType` on each
 * threshold). Kept free of the SDK, so the card, the watcher and the Data Portal can share it.
 */
import type { Layer, WidgetDataConfig } from "$lib/data/schema";
import type { WidgetInstance } from "$lib/documents/schema";
import { thresholdFor } from "$lib/thresholds/levels";
import { markKey } from "$lib/thresholds/marks.svelte";
import type { Threshold } from "$lib/thresholds/schema";
import { CURRENT_TYPE } from "./index";

const AIR_QUALITY = "air-quality";

/** The entry types of `data`'s air-quality layers, in layer order. */
export function currentPollutants(data: WidgetDataConfig): string[] {
	return data.layers.flatMap((l) =>
		l.dataset === AIR_QUALITY && l.entryType ? [l.entryType] : []
	);
}

/**
 * The key a watched widget's one mark is written under: Current conditions' first pollutant's (the
 * one its watcher reads), the widget id for every other type.
 */
export function watchedMarkKey(widget: Pick<WidgetInstance, "id" | "type" | "data">): string {
	return widget.type === CURRENT_TYPE
		? markKey(widget.id, currentPollutants(widget.data)[0])
		: markKey(widget.id);
}

/** `entryType`'s saved alert level, as a one-pollutant widget saves it (no `entryType`). */
function oneThreshold(
	saved: Threshold[] | undefined,
	entryType: string | undefined
): Threshold[] | undefined {
	const found = entryType === undefined ? undefined : thresholdFor(saved, entryType);
	return found ? [{ level: found.level }] : undefined;
}

/**
 * `widget` showing only `entryType`: one layer, `layers[0]` (which holds the monitor) with
 * `entryType` swapped in, and only that pollutant's alert level, without its `entryType`. What the
 * card and the watcher read per pollutant.
 */
export function onePollutant(widget: WidgetInstance, entryType: string): WidgetInstance {
	const { thresholds: saved, ...rest } = widget;
	const first = widget.data.layers[0];
	const layer: Layer = structuredClone({ ...(first ?? { dataset: AIR_QUALITY }), entryType });
	const thresholds = oneThreshold(saved, entryType);
	return {
		...rest,
		data: { ...structuredClone(widget.data), layers: [layer] },
		...(thresholds ? { thresholds } : {})
	};
}

/**
 * `data` with one air-quality layer per entry type, in the order given; `layers[0]`'s monitors
 * move to the new first layer. With none it keeps a single air-quality layer with no entry type
 * that still holds the monitor (7a's decision 31), so a monitor isn't lost while nothing is ticked.
 */
export function setCurrentPollutants(
	data: WidgetDataConfig,
	entryTypes: string[]
): WidgetDataConfig {
	const monitors = data.layers[0]?.monitors;
	const held = monitors?.length ? { monitors: [...monitors] } : {};
	const layers: Layer[] =
		entryTypes.length === 0
			? [{ dataset: AIR_QUALITY, ...held }]
			: entryTypes.map((entryType, i) => ({
					dataset: AIR_QUALITY,
					entryType,
					...(i === 0 ? held : {})
				}));
	return { ...structuredClone(data), layers };
}

/**
 * A Current conditions draft cut to its first pollutant: the other pollutants' layers go (any other
 * layer stays), and its alert level is that pollutant's, without its `entryType` (none when no
 * pollutant is ticked). What Show as checks and converts from. Another type's draft is returned as
 * it is.
 */
export function firstPollutantOnly<
	D extends { type: string; data: WidgetDataConfig; thresholds?: Threshold[] }
>(draft: D): D {
	if (draft.type !== CURRENT_TYPE) return draft;
	const first = currentPollutants(draft.data)[0];
	const other = (l: Layer) => l.dataset === AIR_QUALITY && !!l.entryType && l.entryType !== first;
	const { thresholds: saved, ...rest } = draft;
	const thresholds = oneThreshold(saved, first);
	return {
		...rest,
		data: structuredClone({ ...draft.data, layers: draft.data.layers.filter((l) => !other(l)) }),
		...(thresholds ? { thresholds } : {})
	} as D;
}
