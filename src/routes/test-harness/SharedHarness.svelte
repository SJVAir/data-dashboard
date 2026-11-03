<script lang="ts">
	import { Router } from "sv-router";
	import LiveRegion from "$lib/components/a11y/LiveRegion.svelte";
	import ExistingCopyDialog from "$lib/components/dialogs/ExistingCopyDialog.svelte";
	import UndoRedo from "$lib/components/shell/UndoRedo.svelte";
	import { Toaster } from "$lib/components/ui/sonner";
	import "../../router";
	import SharedPage from "../SharedPage.svelte";

	/** `routed`: through the app's router (it listens for Back), as the real page is. */
	let { routed = false }: { routed?: boolean } = $props();
</script>

<UndoRedo />
<main>
	{#if routed}
		<Router />
	{:else}
		<SharedPage />
	{/if}
</main>
<ExistingCopyDialog />
<Toaster />
<LiveRegion />
