<script lang="ts">
	import { untrack } from "svelte";
	import { regionsPlugin, type MapContext } from "@sjvair/map-sdk";
	import type { DataSource, MapFeatureProperties } from "@sjvair/map-sdk/data";
	import type { MapLevel } from "../days";
	import { thinDetail } from "../thin-detail";
	import { beforeIn } from "./order";

	/** The region fill's plugin, added while it's drawn; renders nothing. */
	let {
		map,
		source,
		label,
		loads,
		drawn,
		period,
		legendUnits
	}: {
		map: MapContext;
		source: DataSource;
		/** The fill's layer label; none, no fill. */
		label: string | undefined;
		/** Whether the tile loads its data. */
		loads: boolean;
		/** Whether the fill is on the map. */
		drawn: boolean;
		/** A Monthly or Yearly stop's level; undefined on a day or now (so a step there remakes nothing). */
		period: Exclude<MapLevel, "day"> | undefined;
		/** The legend's unit line (the units and figure on a Monthly or Yearly stop); else unset. */
		legendUnits: string | undefined;
	} = $props();

	// The fill: under pesticide use and the focus area (so its wash dims the fill outside the
	// places), over the basemap. Regions can't be marked; one with no figure is an outline reading
	// "No data", with its reason on a Monthly or Yearly stop when its row had too few days with a
	// figure (as the monitors'). A thin day keeps "No data" alone: "Not enough data" would repeat it.
	$effect(() => {
		const current = map;
		const layerLabel = label;
		const level = period;
		const units = legendUnits;
		if (!layerLabel || !loads || !drawn) return;
		const plugin = regionsPlugin({
			id: "fill",
			source,
			layerLabel,
			selectable: false,
			noFigure: "outline",
			...(level && { detail: (props: MapFeatureProperties) => thinDetail(props, level) }),
			...(units && { legendUnits: units })
		});
		untrack(() => current.addPlugin(plugin, beforeIn(current, plugin.id)));
		return () => current.removePlugin(plugin.id);
	});
</script>
