import type { PlaceInfo } from "$lib/data/types";
import { formatNumber } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";

/**
 * A number layer's name with its source: a weather station with its distance (just its name when
 * the place is inside the station's area), or the active filters, then `place` when given. Each
 * part goes through the same message, so no sentence is concatenated. Used by the Chart's legend
 * rows and the Data table's column headers.
 */
export function sourceLabel(layer: string, info: PlaceInfo | undefined, place?: string): string {
	const key = (source: string) => m.label_join({ first: layer, second: source });
	const station = info?.source;
	if (station) {
		return key(
			station.inside
				? station.name
				: m.chart_strip_station({
						station: station.name,
						distance: formatNumber(station.distance, { maximumFractionDigits: 1 })
					})
		);
	}
	// "Pounds applied · Chlorpyrifos · Grapes · ZIP 93702".
	return [...(info?.filters ?? []), ...(place ? [place] : [])].reduce(
		(name, source) => m.label_join({ first: name, second: source }),
		layer
	);
}
