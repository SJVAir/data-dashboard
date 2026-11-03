<script lang="ts">
	import LiveRegion from "$lib/components/a11y/LiveRegion.svelte";
	import RenameDialog from "$lib/components/dialogs/RenameDialog.svelte";
	import { Toaster } from "$lib/components/ui/sonner";
	import type { Dashboard } from "$lib/documents/schema";
	import type { Arrangement } from "$lib/layout/arrangement.svelte";
	import DashboardGrid from "../DashboardGrid.svelte";

	let {
		onArrangement,
		view
	}: { onArrangement?: (arrangement: Arrangement) => void; view?: Dashboard } = $props();
</script>

<DashboardGrid {onArrangement} {view} />
<RenameDialog />
<Toaster />
<LiveRegion />
