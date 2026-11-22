import type { Effective } from "$lib/data/dataset-rules";
import type { QueryInput } from "$lib/data/types";
import type { WidgetOverlay } from "./data-widget.svelte";
import { LEVEL_LOWER } from "$lib/get-data/level-phrases";
import { m } from "$lib/paraglide/messages.js";
import { everywhereMain } from "./overlays";

/**
 * One note per overlay layer that doesn't offer the widget's data resolution (from untrusted input:
 * a share link or an import; Get data never builds one). Such a layer isn't fetched or drawn; the
 * note names its dataset (the catalog's label) and, when the dashboard can be edited, says to change
 * the resolution in Edit data. Layers the catalog doesn't list yet get none.
 */
export function misfitNotes(
	overlays: WidgetOverlay[],
	effective: Effective | undefined,
	editable: boolean
): string[] {
	if (!effective) return [];
	return overlays.flatMap((o) => {
		const dataset = o.meta?.dataset.label;
		if (!dataset || !effective.misfits.includes(o.layer)) return [];
		if (effective.resolution === "raw") {
			return [
				editable
					? m.widget_layer_not_lined_up_raw({ dataset })
					: m.widget_layer_not_lined_up_raw_view({ dataset })
			];
		}
		const level = LEVEL_LOWER[effective.resolution]();
		return [
			editable
				? m.widget_layer_not_lined_up({ dataset, level })
				: m.widget_layer_not_lined_up_view({ dataset, level })
		];
	});
}

/**
 * One note per overlay of a main with no Where and no monitors (`everywhereMain`): such an
 * overlay isn't fetched, as an everywhere overlay has no line of the main's to pair with. The
 * note names the layer (the catalog's label) and says to add a place. Layers the catalog doesn't
 * list yet get none.
 */
export function noWhereNotes(overlays: WidgetOverlay[], main: QueryInput | null): string[] {
	if (!everywhereMain(main)) return [];
	return overlays.flatMap((o) => {
		const layer = o.meta?.entryType.label;
		return layer ? [m.widget_overlay_needs_place({ layer })] : [];
	});
}
