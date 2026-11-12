<script lang="ts">
	import type { Snippet } from "svelte";
	import { fakeMaps, type FakeMap } from "./fake-map.svelte";

	let {
		map,
		active = true,
		label,
		overlays,
		featureList,
		selectionBar,
		tooltip,
		card = false,
		class: className
	}: {
		map: FakeMap;
		active?: boolean;
		label?: string;
		overlays?: Snippet;
		featureList?: unknown;
		selectionBar?: boolean;
		tooltip?: string;
		card?: boolean;
		class?: string;
	} = $props();

	$effect(() => {
		map.view = { active, label, featureList, selectionBar, tooltip, card };
	});

	// Like MapView making its GL map where there's no WebGL.
	$effect(() => {
		if (active && fakeMaps.failView) {
			fakeMaps.failView = false;
			throw new Error("Failed to initialize WebGL");
		}
	});
</script>

<!-- Like map-sdk with `card`: a click on the map pins the monitor under it (and never selects). -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div
	class={className}
	role="region"
	aria-label={label ?? "Map"}
	data-fake-map={map.uid}
	data-active={active}
	onclick={() => {
		if (card) map.pinned = { hit: { pluginId: "monitors", refKey: "monitor:a", name: "a" } };
	}}
>
	{@render overlays?.()}
</div>
