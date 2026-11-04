<script lang="ts">
	import LiveRegion from "$lib/components/a11y/LiveRegion.svelte";
	import RenameDialog from "$lib/components/dialogs/RenameDialog.svelte";
	import { Toaster } from "$lib/components/ui/sonner";
	import type { Dashboard } from "$lib/documents/schema";
	import { setContext } from "svelte";
	import { ARRANGEMENT_PROBE_KEY, type Arrangement } from "$lib/layout/arrangement.svelte";
	import DashboardGrid from "../DashboardGrid.svelte";

	let {
		onArrangement,
		view
	}: {
		/** Given the grid's arrangement controller once it's made (through a context). */
		onArrangement?: (arrangement: Arrangement) => void;
		view?: Dashboard;
	} = $props();
	setContext(ARRANGEMENT_PROBE_KEY, (arrangement: Arrangement) => onArrangement?.(arrangement));
</script>

<DashboardGrid {view} />
<RenameDialog />
<Toaster />
<LiveRegion />
