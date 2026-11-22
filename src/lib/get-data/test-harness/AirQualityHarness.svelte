<script lang="ts">
	import type { CatalogEntry } from "$lib/data/metadata";
	import type { WidgetDataConfig } from "$lib/data/schema";
	import AirQualitySection from "../AirQualitySection.svelte";
	import * as layers from "../layers";

	let {
		initial,
		catalog,
		limit,
		onchange
	}: {
		initial: WidgetDataConfig;
		catalog: CatalogEntry[];
		limit: number;
		/** Each edit's resulting data (a plain copy). */
		onchange?: (data: WidgetDataConfig) => void;
	} = $props();

	// As in the Data Portal: the draft is edited in place by `layers`' edits.
	// svelte-ignore state_referenced_locally
	let data = $state<WidgetDataConfig>(structuredClone(initial));
	const plain = $derived($state.snapshot(data) as WidgetDataConfig);
	const changed = () => onchange?.($state.snapshot(data) as WidgetDataConfig);
	const aq = $derived(catalog.find((c) => c.id === "air-quality"));
</script>

<AirQualitySection
	data={plain}
	{catalog}
	{limit}
	pollutants={aq?.entryTypes.filter((e) => e.available !== false) ?? []}
	onpollutant={(pick) => {
		layers.setPollutant(data, catalog, pick);
		changed();
	}}
	ontypes={(types) => {
		layers.setMonitorTypes(data, catalog, types);
		changed();
	}}
	onmonitors={(ids) => {
		layers.setMonitors(data, catalog, ids);
		layers.dropWhereForMonitor(data, limit);
		changed();
	}}
/>
