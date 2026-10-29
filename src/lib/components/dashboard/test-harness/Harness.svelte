<script lang="ts">
	import LiveRegion from "$lib/components/a11y/LiveRegion.svelte";
	import RenameDialog from "$lib/components/dialogs/RenameDialog.svelte";
	import { Toaster } from "$lib/components/ui/sonner";
	import type { Arrangement } from "$lib/layout/arrangement.svelte";
	import DashboardGrid from "../DashboardGrid.svelte";

	let { onArrangement }: { onArrangement?: (arrangement: Arrangement) => void } = $props();
</script>

<DashboardGrid {onArrangement} />
<RenameDialog />
<Toaster />
<LiveRegion />
