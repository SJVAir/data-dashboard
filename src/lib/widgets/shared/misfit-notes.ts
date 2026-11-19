import type { Effective } from "$lib/data/dataset-rules";
import type { WidgetOverlay } from "./data-widget.svelte";
import { LEVEL_LOWER } from "$lib/get-data/level-phrases";
import { m } from "$lib/paraglide/messages.js";

/**
 * One note per overlay layer that doesn't offer the widget's data resolution (from untrusted input:
 * a share link or an import; Get data never builds one). Such a layer isn't fetched or drawn; the
 * note names its dataset (the catalog's label) and says to change the resolution in Edit data.
 * Layers the catalog doesn't list yet get none.
 */
export function misfitNotes(overlays: WidgetOverlay[], effective: Effective | undefined): string[] {
	if (!effective) return [];
	return overlays.flatMap((o) => {
		const dataset = o.meta?.dataset.label;
		if (!dataset || !effective.misfits.includes(o.layer)) return [];
		return [
			effective.resolution === "raw"
				? m.widget_layer_not_lined_up_raw({ dataset })
				: m.widget_layer_not_lined_up({ dataset, level: LEVEL_LOWER[effective.resolution]() })
		];
	});
}
