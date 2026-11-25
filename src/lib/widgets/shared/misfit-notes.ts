import type { Effective } from "$lib/data/dataset-rules";
import type { CatalogEntry } from "$lib/data/metadata";
import type { WidgetDataConfig } from "$lib/data/schema";
import type { WidgetOverlay } from "./data-widget.svelte";
import { LEVEL_LOWER } from "$lib/get-data/level-phrases";
import { m } from "$lib/paraglide/messages.js";
import { drawnMonitors, idleTypes } from "./input";

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
 * The note for ticked monitor types that draw nothing because the widget has no Where (they're
 * counted only inside Where's areas), when it draws its searched monitors; with nothing drawn the
 * widget's empty message already says to add a place. When the dashboard can be edited it says to
 * add one.
 */
export function idleTypesNote(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined,
	editable: boolean
): string | null {
	if (idleTypes(data, catalog).length === 0) return null;
	if (drawnMonitors(data, catalog).monitors.length === 0) return null;
	return editable ? m.widget_types_need_place() : m.widget_types_need_place_view();
}
