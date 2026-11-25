<script lang="ts">
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import { menuScope } from "$lib/actions/scope";
	import { dashboardMenu } from "$lib/components/dashboard/dashboard-menu.svelte";
	import { openMenuFor } from "$lib/components/menu/menu-state.svelte";
	import { Button } from "$lib/components/ui/button";
	import { m } from "$lib/paraglide/messages.js";

	let more = $state<HTMLElement | null>(null);
	const provider = $derived(dashboardMenu.provider);
</script>

{#if provider}
	<Button
		bind:ref={more}
		variant="ghost"
		size="icon-sm"
		aria-label={m.dashboard_menu()}
		inert={dashboardMenu.inert}
		{@attach menuScope(provider)}
		onclick={() => more && openMenuFor(more)}
	>
		<Ellipsis aria-hidden="true" />
	</Button>
{/if}
