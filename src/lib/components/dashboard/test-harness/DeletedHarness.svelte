<script lang="ts">
	import ConfirmDialog from "$lib/components/dialogs/ConfirmDialog.svelte";
	import { Toaster } from "$lib/components/ui/sonner";
	import RecentlyDeleted from "../RecentlyDeleted.svelte";
</script>

<RecentlyDeleted />
<ConfirmDialog />
<Toaster />
