<script lang="ts">
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import { openMenuFor } from "$lib/components/menu/menu-state.svelte";
	import { Button } from "$lib/components/ui/button";
	import { m } from "$lib/paraglide/messages.js";

	let { inert = false }: { inert?: boolean } = $props();

	let more = $state<HTMLElement | null>(null);
</script>

<div data-testid="dashboard-header" class="flex justify-end" {inert}>
	<Button
		bind:ref={more}
		variant="ghost"
		size="icon-sm"
		aria-label={m.dashboard_menu()}
		onclick={(event) => more && openMenuFor(more, {}, event)}
	>
		<Ellipsis aria-hidden="true" />
	</Button>
</div>
