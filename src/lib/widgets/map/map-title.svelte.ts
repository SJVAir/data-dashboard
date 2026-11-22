import { onDestroy } from "svelte";
import { getQueryClient } from "$lib/data";
import { LiveQuery } from "$lib/data/live-query.svelte";
import type { Layer, WidgetDataConfig } from "$lib/data/schema";
import { formatNumber } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import { nowInput, singleMonitor } from "../shared/input";
import type { PlaceViewer } from "../shared/viewer";
import { placeLabel } from "../title";
import { setGeneratedTitle } from "../titles.svelte";

/** What the title reads from the tile; each field read on its own. */
export interface MapTitleInput {
	readonly widgetId: string;
	readonly data: WidgetDataConfig;
	readonly layer: Layer | undefined;
	readonly entryLabel: string | undefined;
	readonly idle: boolean;
	readonly supported: boolean;
}

/**
 * The generated title: the one place's label (from the "now" lookup of the Where alone, not its
 * monitors), or with no Where the one searched monitor's, or how many places. Call it while a
 * component initialises (it adds effects).
 */
export function syncMapTitle(input: MapTitleInput, viewer: PlaceViewer): void {
	const titleQuery = new LiveQuery(getQueryClient(), null);
	titleQuery.setPolling(false);
	onDestroy(() => titleQuery.destroy());
	const count = $derived(
		input.layer ? (input.data.selection?.ids.length ?? (input.data.place ? 1 : 0)) : 0
	);
	/** What names the tile: its one Where place (its layer's monitors left out), else its monitor. */
	const named = $derived.by(() => {
		const { layer, data } = input;
		if (!layer) return null;
		if (count === 1) {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars -- left out of the lookup
			const { monitors, monitorTypes, ...where } = layer;
			return nowInput(data, where);
		}
		return count === 0 && singleMonitor(data) ? nowInput(data, layer) : null;
	});
	$effect(() => {
		titleQuery.set(!input.idle && input.supported ? named : null);
	});
	$effect(() => {
		const label = input.entryLabel;
		if (!label || input.idle) return;
		if (count > 1) {
			const places = m.get_data_places_count({ count: formatNumber(count), countValue: count });
			setGeneratedTitle(input.widgetId, m.label_join({ first: label, second: places }));
			return;
		}
		const s = titleQuery.state;
		const place = s.status === "ready" ? s.data.places[0] : undefined;
		if (place) {
			setGeneratedTitle(
				input.widgetId,
				m.label_join({ first: label, second: placeLabel(place, viewer) })
			);
		}
	});
}
