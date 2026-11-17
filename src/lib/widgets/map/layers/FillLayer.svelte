<script lang="ts">
	import { untrack } from "svelte";
	import { regionsPlugin, type MapContext } from "@sjvair/map-sdk";
	import type { DataSource } from "@sjvair/map-sdk/data";

	/** The region fill's plugin, added while it's drawn; renders nothing. */
	let {
		map,
		source,
		label,
		loads,
		drawn
	}: {
		map: MapContext;
		source: DataSource;
		/** The fill's layer label; none, no fill. */
		label: string | undefined;
		/** Whether the tile loads its data. */
		loads: boolean;
		/** Whether the fill is on the map. */
		drawn: boolean;
	} = $props();

	// The fill: under the focus area (so its wash dims the fill outside the places), over the
	// basemap. Regions can't be marked; one with no figure is an outline reading "No data".
	$effect(() => {
		const current = map;
		const layerLabel = label;
		if (!layerLabel || !loads || !drawn) return;
		const plugin = regionsPlugin({
			id: "fill",
			source,
			layerLabel,
			selectable: false,
			noFigure: "outline"
		});
		untrack(() => current.addPlugin(plugin, { before: "focus" }));
		return () => current.removePlugin(plugin.id);
	});
</script>
