<script lang="ts">
	import type { WidgetInstance } from "$lib/documents/schema";
	import type { QueryState } from "$lib/data/types";
	import WidgetState from "../WidgetState.svelte";

	let {
		state,
		widget,
		retired,
		onretry,
		onchoose
	}: {
		state: QueryState;
		widget: WidgetInstance;
		retired?: { name: string; since: string };
		onretry: () => void;
		onchoose?: () => void;
	} = $props();
</script>

<WidgetState {state} {widget} {retired} {onretry} {onchoose}>
	{#snippet children(data)}
		<p data-testid="content">content {data.series.length}</p>
	{/snippet}
</WidgetState>
