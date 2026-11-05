<script lang="ts">
	import LiveRegion from "$lib/components/a11y/LiveRegion.svelte";
	import LazyDialogs from "$lib/components/dialogs/LazyDialogs.svelte";
	import DashboardGrid from "$lib/components/dashboard/DashboardGrid.svelte";
	import { Toaster } from "$lib/components/ui/sonner";

	// As in the app: the editable dashboard, the lazily loaded dialogs, toasts and the page's region.
</script>

<DashboardGrid />
<LazyDialogs />
<Toaster />
<LiveRegion />
