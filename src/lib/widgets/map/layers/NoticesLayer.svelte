<script lang="ts">
	import { untrack, type Snippet } from "svelte";
	import { pointsPlugin, type MapContext } from "@sjvair/map-sdk";
	import type { DataSource } from "@sjvair/map-sdk/data";
	import { m } from "$lib/paraglide/messages.js";
	import type { NoticeFeatureProperties } from "../data/notices";
	import { noticeTooltips } from "../notice-tooltip";
	import { underMonitors } from "./order";

	/** The notices' clusters, as the monitors' (map-sdk sums their counts itself). */
	const NOTICES_CLUSTER = { radius: 40, maxZoom: 9 };

	/** The spray notices' plugin, added while they're drawn; renders nothing. */
	let {
		map,
		source,
		label,
		drawn,
		loads,
		clustered,
		onNow,
		byRef,
		note
	}: {
		map: MapContext;
		source: DataSource<NoticeFeatureProperties>;
		/** The notices' layer label: the catalog's name for the data set. */
		label: string | undefined;
		/** Whether the notices are on the map. */
		drawn: boolean;
		/** Whether the tile loads its data. */
		loads: boolean;
		/** Marker clusters, as the monitors'. */
		clustered: boolean;
		/** Whether the tile shows now (not a day stop); read when a card is shown. */
		onNow: boolean;
		/** Each marker's latest properties, by refKey; read when a card is shown. */
		byRef: ReadonlyMap<string, NoticeFeatureProperties>;
		/** The legend section's note. */
		note: Snippet;
	} = $props();

	// The notices: above the fill, under the monitors; numbered markers, in the color of the
	// server's one-level spray-notice scale. Clustered as the monitors are. The legend section is
	// the scale's level, a units line for the number, and the note (none for the day, filters,
	// the explainer).
	$effect(() => {
		const current = map;
		const layerLabel = label;
		const clusters = clustered;
		const legendNote = note;
		if (!layerLabel || !loads || !drawn) return;
		const noticeTooltip = noticeTooltips((refKey) => byRef.get(refKey));
		const plugin = pointsPlugin({
			id: "notices",
			source,
			layerLabel,
			count: { property: "count" },
			legendUnits: m.map_notices_legend_units(),
			legendNote,
			// The card (its own heading); read when shown, so it follows the day stop and the pin.
			// map-sdk shows the interactive card for the pinned or keyboard-focused feature and a
			// non-interactive tooltip on hover, which gets the static form.
			tooltip: (item, props: NoticeFeatureProperties) =>
				noticeTooltip(
					props,
					onNow,
					current.focusedKey === item.refKey || current.pinned?.hit.refKey === item.refKey
				),
			tooltipShowsName: true,
			...(clusters && { cluster: NOTICES_CLUSTER })
		});
		untrack(() => current.addPlugin(plugin, underMonitors(current)));
		return () => current.removePlugin(plugin.id);
	});
</script>
