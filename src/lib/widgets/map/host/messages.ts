import type { MessageKey, MessageParams, MessageProvider } from "@sjvair/map-sdk/data";
import { m } from "$lib/paraglide/messages.js";

type Message = (params?: MessageParams) => string;

/** A Paraglide message taking map-sdk's params (map-sdk names them; Paraglide types them). */
function fill(message: (inputs: never) => string): Message {
	return (params) => message((params ?? {}) as never);
}

const plurals = new Intl.PluralRules("en");

/** A plural base key: map-sdk passes `count`, and the catalog holds `_one` and `_other`. */
function plural(one: (inputs: never) => string, other: (inputs: never) => string): Message {
	return (params) => {
		const count = typeof params?.count === "number" ? params.count : NaN;
		return fill(plurals.select(count) === "one" ? one : other)(params);
	};
}

/**
 * Every map-sdk message key, as a Paraglide message (an explicit table, not `import * as m`, so
 * only the map chunk pulls these messages in). A test checks it against map-sdk's catalog.
 */
export const MAP_MESSAGES: Record<MessageKey, Message> = {
	mapsdk_list_button: fill(m.mapsdk_list_button),
	mapsdk_list_button_label: fill(m.mapsdk_list_button_label),
	mapsdk_list_label: fill(m.mapsdk_list_label),
	mapsdk_list_sort_name: fill(m.mapsdk_list_sort_name),
	mapsdk_list_sort_value: fill(m.mapsdk_list_sort_value),
	mapsdk_list_row: fill(m.mapsdk_list_row),
	mapsdk_list_row_no_units: fill(m.mapsdk_list_row_no_units),
	mapsdk_list_row_no_value: fill(m.mapsdk_list_row_no_value),
	mapsdk_list_row_level: fill(m.mapsdk_list_row_level),
	mapsdk_list_row_detail: fill(m.mapsdk_list_row_detail),
	mapsdk_list_empty: fill(m.mapsdk_list_empty),
	mapsdk_selected_count_one: fill(m.mapsdk_selected_count_one),
	mapsdk_selected_count: plural(m.mapsdk_selected_count_one, m.mapsdk_selected_count_other),
	mapsdk_selected_count_other: fill(m.mapsdk_selected_count_other),
	mapsdk_selection_clear: fill(m.mapsdk_selection_clear),
	mapsdk_selection_clear_layer: fill(m.mapsdk_selection_clear_layer),
	mapsdk_selected_in_layer: fill(m.mapsdk_selected_in_layer),
	mapsdk_selection_cleared: fill(m.mapsdk_selection_cleared),
	mapsdk_summary_one: fill(m.mapsdk_summary_one),
	mapsdk_summary: plural(m.mapsdk_summary_one, m.mapsdk_summary_other),
	mapsdk_summary_other: fill(m.mapsdk_summary_other),
	mapsdk_summary_level: fill(m.mapsdk_summary_level),
	mapsdk_summary_with_levels: fill(m.mapsdk_summary_with_levels),
	mapsdk_no_level: fill(m.mapsdk_no_level),
	mapsdk_zoom_in: fill(m.mapsdk_zoom_in),
	mapsdk_zoom_out: fill(m.mapsdk_zoom_out),
	mapsdk_map_label: fill(m.mapsdk_map_label),
	mapsdk_unavailable: fill(m.mapsdk_unavailable),
	mapsdk_loading: fill(m.mapsdk_loading),
	mapsdk_error_retry: fill(m.mapsdk_error_retry),
	mapsdk_legend_label: fill(m.mapsdk_legend_label),
	mapsdk_legend_threshold: fill(m.mapsdk_legend_threshold),
	mapsdk_controls_label: fill(m.mapsdk_controls_label),
	mapsdk_selection_label: fill(m.mapsdk_selection_label),
	mapsdk_no_reading: fill(m.mapsdk_no_reading),
	mapsdk_time_with_zone: fill(m.mapsdk_time_with_zone),
	mapsdk_monitor_cluster_average: fill(m.mapsdk_monitor_cluster_average),
	mapsdk_monitor_cluster_title: fill(m.mapsdk_monitor_cluster_title),
	mapsdk_monitor_cluster_title_sjvair: fill(m.mapsdk_monitor_cluster_title_sjvair),
	mapsdk_monitor_cluster_count_one: fill(m.mapsdk_monitor_cluster_count_one),
	mapsdk_monitor_cluster_count: plural(
		m.mapsdk_monitor_cluster_count_one,
		m.mapsdk_monitor_cluster_count_other
	),
	mapsdk_monitor_cluster_count_other: fill(m.mapsdk_monitor_cluster_count_other),
	mapsdk_monitor_cluster_count_area_one: fill(m.mapsdk_monitor_cluster_count_area_one),
	mapsdk_monitor_cluster_count_area: plural(
		m.mapsdk_monitor_cluster_count_area_one,
		m.mapsdk_monitor_cluster_count_area_other
	),
	mapsdk_monitor_cluster_count_area_other: fill(m.mapsdk_monitor_cluster_count_area_other),
	mapsdk_monitor_cluster_max: fill(m.mapsdk_monitor_cluster_max),
	mapsdk_monitor_cluster_min: fill(m.mapsdk_monitor_cluster_min),
	mapsdk_monitor_interval_avg: fill(m.mapsdk_monitor_interval_avg),
	mapsdk_monitor_updated: fill(m.mapsdk_monitor_updated),
	mapsdk_hms_smoke_name: fill(m.mapsdk_hms_smoke_name),
	mapsdk_hms_fire_detection: fill(m.mapsdk_hms_fire_detection),
	mapsdk_hms_fire_box_header: fill(m.mapsdk_hms_fire_box_header),
	mapsdk_hms_fire_box_header_no_units: fill(m.mapsdk_hms_fire_box_header_no_units),
	mapsdk_hms_fire_average: fill(m.mapsdk_hms_fire_average),
	mapsdk_level_with_units: fill(m.mapsdk_level_with_units),
	mapsdk_hms_fire_detections_one: fill(m.mapsdk_hms_fire_detections_one),
	mapsdk_hms_fire_detections: plural(
		m.mapsdk_hms_fire_detections_one,
		m.mapsdk_hms_fire_detections_other
	),
	mapsdk_hms_fire_detections_other: fill(m.mapsdk_hms_fire_detections_other),
	mapsdk_collocation_reference: fill(m.mapsdk_collocation_reference),
	mapsdk_collocation_colocated: fill(m.mapsdk_collocation_colocated),
	mapsdk_collocation_interval_avg: fill(m.mapsdk_collocation_interval_avg),
	mapsdk_collocation_updated: fill(m.mapsdk_collocation_updated)
};

/** map-sdk's `messages` provider over the dashboard's Paraglide catalog. */
export const mapMessages: MessageProvider = (key, params) =>
	Object.hasOwn(MAP_MESSAGES, key) ? MAP_MESSAGES[key](params) : key;
