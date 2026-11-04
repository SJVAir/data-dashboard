<script lang="ts">
	import type { WidgetInstance } from "$lib/documents/schema";
	import type { PlaceInfo, QueryState } from "$lib/data/types";
	import WidgetState from "../WidgetState.svelte";

	let {
		state,
		places,
		widget,
		retired,
		onretry
	}: {
		state: QueryState;
		places?: PlaceInfo[];
		widget: WidgetInstance;
		retired?: { name: string; since: string };
		onretry: () => void;
	} = $props();
</script>

<WidgetState {state} {places} {widget} {retired} {onretry}>
	{#snippet children(data)}
		<p data-testid="content">content {data.series.length}</p>
	{/snippet}
</WidgetState>
