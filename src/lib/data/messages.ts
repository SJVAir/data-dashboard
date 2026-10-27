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
	"whole-layer-raw": m.data_unavailable_whole_layer_raw
};

/** The message a widget shows for an `unavailable` query state. */
export function unavailableMessage(reason: UnavailableReason): string {
	return UNAVAILABLE[reason]();
}
