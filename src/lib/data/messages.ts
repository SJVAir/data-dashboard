import { m } from "$lib/paraglide/messages.js";
import type { UnavailableReason } from "./types";

const UNAVAILABLE: Record<UnavailableReason, () => string> = {
	"catalog-unavailable": m.data_unavailable_catalog,
	"unknown-dataset": m.data_unavailable_unknown_dataset,
	"unknown-entry-type": m.data_unavailable_unknown_entry_type,
	"no-adapter": m.data_unavailable_no_adapter,
	"no-resolution": m.data_unavailable_no_resolution,
	"place-unsupported": m.data_unavailable_place_unsupported,
	"region-unresolved": m.data_unavailable_region_unresolved,
	"location-unresolved": m.data_unavailable_location_unresolved,
	"point-outside": m.data_unavailable_point_outside,
	"monitor-unlisted": m.data_unavailable_monitor_unlisted,
	"filter-gone": m.data_unavailable_filter_gone,
	"none-measure": m.data_unavailable_none_measure
};

/** The message a widget shows for an `unavailable` query state. */
export function unavailableMessage(reason: UnavailableReason): string {
	return UNAVAILABLE[reason]();
}
