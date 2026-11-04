<script lang="ts">
	import type { WidgetInstance } from "$lib/documents/schema";
	import WidgetState from "../WidgetState.svelte";

	// A test widget type's component: always the "no longer available" card.
	let { widget }: { widget: WidgetInstance } = $props();
</script>

{#snippet none()}{/snippet}

<WidgetState
	state={{ status: "unavailable", reason: "region-unresolved" }}
	{widget}
	onretry={() => {}}
	children={none}
/>
