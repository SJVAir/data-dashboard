<script lang="ts">
	import { untrack } from "svelte";
	import { hmsFirePlugin, hmsSmokePlugin, type MapContext } from "@sjvair/map-sdk";
	import type { DataSource, FireFeatureProperties } from "@sjvair/map-sdk/data";
	import { underMonitors } from "./order";

	/** Smoke and fire's plugins, under the monitors, added while they're shown; renders nothing. */
	let {
		map,
		smokeSource,
		fireSource,
		hotspotsSource,
		smokeLabel,
		fireLabel,
		loads,
		shown
	}: {
		map: MapContext;
		smokeSource: DataSource<FireFeatureProperties>;
		fireSource: DataSource<FireFeatureProperties>;
		hotspotsSource: DataSource<FireFeatureProperties>;
		/** The catalog's names for the data sets; none, that layer isn't drawn. */
		smokeLabel: string | undefined;
		fireLabel: string | undefined;
		/** Whether the tile loads its data. */
		loads: boolean;
		/** Whether smoke and fire are on the map. */
		shown: boolean;
	} = $props();

	$effect(() => {
		const current = map;
		const label = smokeLabel;
		if (!label || !loads || !shown) return;
		const plugin = hmsSmokePlugin({ source: smokeSource, layerLabel: label });
		untrack(() => current.addPlugin(plugin, underMonitors(current)));
		return () => current.removePlugin(plugin.id);
	});

	$effect(() => {
		const current = map;
		const label = fireLabel;
		if (!label || !loads || !shown) return;
		const plugin = hmsFirePlugin({
			source: fireSource,
			hotspots: hotspotsSource,
			layerLabel: label
		});
		untrack(() => current.addPlugin(plugin, underMonitors(current)));
		return () => current.removePlugin(plugin.id);
	});
</script>
