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
		class: className
	}: {
		map: FakeMap;
		active?: boolean;
		label?: string;
		overlays?: Snippet;
		featureList?: unknown;
		selectionBar?: boolean;
		tooltip?: string;
		class?: string;
	} = $props();

	$effect(() => {
		map.view = { active, label, featureList, selectionBar, tooltip };
	});

	// Like MapView making its GL map where there's no WebGL.
	$effect(() => {
		if (active && fakeMaps.failView) {
			fakeMaps.failView = false;
			throw new Error("Failed to initialize WebGL");
		}
	});
</script>

<div
	class={className}
	role="region"
	aria-label={label ?? "Map"}
	data-fake-map={map.uid}
	data-active={active}
>
	{@render overlays?.()}
</div>
