<script module lang="ts">
	import ContrastIcon from "@lucide/svelte/icons/contrast";
	import FlameIcon from "@lucide/svelte/icons/flame";
	import LayersIcon from "@lucide/svelte/icons/layers";
	import MapIcon from "@lucide/svelte/icons/map";
	import NetworkIcon from "@lucide/svelte/icons/network";
	import RadioTowerIcon from "@lucide/svelte/icons/radio-tower";
	import SettingsIcon from "@lucide/svelte/icons/settings";

	/** The Map toolbar's icons: Lucide, in monitor-map's tints (theme tokens, with dark values). */
	export { monitors, layers, settings, clusters, basemap, theme, fire };
</script>

{#snippet monitors()}
	<RadioTowerIcon class="size-full text-(--map-icon-monitors)" />
{/snippet}

{#snippet layers()}
	<LayersIcon class="size-full text-(--map-icon-layers)" />
{/snippet}

{#snippet settings()}
	<SettingsIcon class="size-full text-(--map-icon-settings)" />
{/snippet}

{#snippet clusters()}
	<NetworkIcon class="size-full text-(--map-icon-clusters)" />
{/snippet}

{#snippet basemap()}
	<MapIcon class="size-full text-(--map-icon-basemap)" />
{/snippet}

{#snippet theme()}
	<ContrastIcon class="size-full text-(--map-icon-theme)" />
{/snippet}

{#snippet fire()}
	<FlameIcon class="size-full text-(--map-icon-fire)" />
{/snippet}
