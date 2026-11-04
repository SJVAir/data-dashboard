<script lang="ts">
	import LiveRegion from "$lib/components/a11y/LiveRegion.svelte";
	import SavedIndicator from "$lib/components/shell/SavedIndicator.svelte";
	import { Toaster } from "$lib/components/ui/sonner";
	import ConflictDialog from "../ConflictDialog.svelte";
	import RestoreVersionDialog from "../RestoreVersionDialog.svelte";

	// The dialogs that announce as they close, with what reads the announcements in the app: the
	// save indicator, the toaster, and the page's live region. `indicator` needs the app context.
	let { indicator = false }: { indicator?: boolean } = $props();
</script>

{#if indicator}
	<SavedIndicator />
	<ConflictDialog />
{/if}
<RestoreVersionDialog />
<Toaster />
<LiveRegion />
