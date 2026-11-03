<script lang="ts">
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import { openMenuFor } from "$lib/components/menu/menu-state.svelte";
	import { Button } from "$lib/components/ui/button";
	import { m } from "$lib/paraglide/messages.js";
	import { basedOn, type BasedOn } from "$lib/shared/credit.svelte";
	import { useApp } from "$lib/store/app.svelte";

	let { inert = false }: { inert?: boolean } = $props();

	const app = useApp();
	let more = $state<HTMLElement | null>(null);

	// What this dashboard is a copy of; nothing while loading, and nothing when unknown.
	const copiedFrom = $derived(app.current.session?.doc.copiedFrom);
	let credit = $state<BasedOn | null>(null);
	$effect(() => {
		const source = copiedFrom;
		let current = true;
		credit = null;
		basedOn(app, source).then((answer) => {
			if (current) credit = answer;
		});
		return () => {
			current = false;
		};
	});
	const line = $derived(
		!credit
			? null
			: credit.name !== null && credit.displayName !== null
				? m.based_on_named_by({ name: credit.name, displayName: credit.displayName })
				: credit.name !== null
					? m.based_on_named({ name: credit.name })
					: credit.displayName !== null
						? m.based_on_shared_by({ displayName: credit.displayName })
						: m.based_on_shared()
	);
</script>

<div data-testid="dashboard-header" class="flex items-center justify-between gap-2" {inert}>
	{#if line}
		<p data-testid="based-on" class="text-muted-foreground min-w-0 truncate text-sm">{line}</p>
	{:else}
		<span></span>
	{/if}
	<Button
		bind:ref={more}
		variant="ghost"
		size="icon-sm"
		aria-label={m.dashboard_menu()}
		onclick={() => more && openMenuFor(more)}
	>
		<Ellipsis aria-hidden="true" />
	</Button>
</div>
