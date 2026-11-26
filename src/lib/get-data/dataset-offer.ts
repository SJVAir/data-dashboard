import {
	LEVELS,
	datasetOffers,
	layerOffers,
	rawCause,
	type Level,
	type PlaceKind,
	type RawCause
} from "$lib/data/dataset-rules";
import type { CatalogEntry } from "$lib/data/metadata";
import type { DateRangeSpec, Layer } from "$lib/data/schema";
import { daysInMonth } from "$lib/format/calendar";
import { m } from "$lib/paraglide/messages.js";
import { LEVEL_BY, LEVEL_LABEL, LEVEL_LOWER } from "./level-phrases";

/** Why a dataset can't be chosen at the widget's data resolution. */
export type DatasetBlock =
	/**
	 * An explicit level `at` it isn't reported at; `suggest` is the nearest level it is. At raw,
	 * `cause` says when the place (an area, ticked types), not the dataset, is why.
	 */
	| { kind: "not-offered"; at: Level; suggest: Level; cause?: RawCause }
	/** On Automatic, it shares no level with the datasets already chosen; reported `by`. */
	| { kind: "no-common"; by: Level };

const rank = (level: Level) => LEVELS.indexOf(level);

/**
 * Whether adding `candidate` (one dataset's layers: a Map's smoke and fire go together) to the
 * `chosen` layers would leave them unable to line up. With an explicit `resolution`, a dataset
 * that doesn't offer it is blocked; on Automatic (`undefined`), one that shares no level in
 * `within` with the chosen layers. `null` when it fits, or when it offers nothing at all (an
 * unknown dataset isn't Get data's to judge).
 */
export function datasetBlock(args: {
	candidate: readonly Layer[];
	chosen: readonly Layer[];
	catalog: CatalogEntry[];
	place: PlaceKind;
	resolution?: Level;
	within?: readonly Level[];
}): DatasetBlock | null {
	const { candidate, chosen, catalog, place, resolution, within = LEVELS } = args;
	const own = (layer: Layer) =>
		layerOffers(layer, catalog, place).filter((level) => within.includes(level));
	if (resolution) {
		for (const layer of candidate) {
			const levels = own(layer);
			if (levels.length === 0 || levels.includes(resolution)) continue;
			// The nearest offered level; between two as near, the coarser.
			const suggest = [...levels].sort(
				(a, b) =>
					Math.abs(rank(a) - rank(resolution)) - Math.abs(rank(b) - rank(resolution)) ||
					rank(b) - rank(a)
			)[0];
			const cause = resolution === "raw" ? rawCause(layer, catalog, place) : null;
			return { kind: "not-offered", at: resolution, suggest, ...(cause ? { cause } : {}) };
		}
		return null;
	}
	if (datasetOffers([...chosen, ...candidate], catalog, place, within).length > 0) return null;
	const culprit =
		candidate.find(
			(layer) => datasetOffers([...chosen, layer], catalog, place, within).length === 0
		) ?? candidate[0];
	const by = culprit ? own(culprit)[0] : undefined;
	return by ? { kind: "no-common", by } : null;
}

/**
 * A dataset block's reason, shown beside the greyed choice. A `pinned` type (a calendar) says
 * it, not the data resolution, sets the level.
 */
export function datasetBlockText(block: DatasetBlock, pinned?: boolean): string {
	if (block.kind === "no-common") {
		return m.get_data_dataset_no_common({ by: LEVEL_BY[block.by]() });
	}
	if (pinned) {
		return m.get_data_dataset_not_offered_pinned({
			by: LEVEL_BY[block.suggest](),
			level: LEVEL_LOWER[block.at]()
		});
	}
	const level = LEVEL_LABEL[block.suggest]();
	if (block.cause === "area") return m.get_data_dataset_raw_area({ level });
	if (block.cause === "monitor-types") return m.get_data_dataset_raw_types({ level });
	return block.at === "raw"
		? m.get_data_dataset_not_offered_raw({ level })
		: m.get_data_dataset_not_offered({ by: LEVEL_BY[block.suggest](), level });
}

/**
 * A custom range picked in whole periods: from the first day of `start` to the last day of `end`
 * (`YYYY-MM` at Monthly, `YYYY` at Yearly).
 */
export function wholePeriodRange(
	start: string,
	end: string,
	unit: "month" | "year"
): Extract<DateRangeSpec, { kind: "custom" }> {
	if (unit === "year") return { kind: "custom", start: `${start}-01-01`, end: `${end}-12-31` };
	const last = String(daysInMonth(`${end}-01`)).padStart(2, "0");
	return { kind: "custom", start: `${start}-01`, end: `${end}-${last}` };
}
