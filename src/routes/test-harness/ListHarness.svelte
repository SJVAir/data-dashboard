<script lang="ts">
	import RenameDialog from "$lib/components/dialogs/RenameDialog.svelte";
	import { Toaster } from "$lib/components/ui/sonner";
	import DashboardList from "../DashboardList.svelte";
</script>

<DashboardList />
<RenameDialog />
<Toaster />
