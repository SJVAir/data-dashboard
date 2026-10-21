<script lang="ts">
	import { Router } from "sv-router";
	import ConflictDialog from "$lib/components/dialogs/ConflictDialog.svelte";
	import RenameDialog from "$lib/components/dialogs/RenameDialog.svelte";
	import TopNav from "$lib/components/shell/TopNav.svelte";
	import { Toaster } from "$lib/components/ui/sonner";
	// Imported for its side effect too: it sets up the route table.
	import "./router";
</script>

<div class="flex min-h-dvh flex-col">
	<TopNav />
	<main class="flex-1">
		<Router />
	</main>
</div>
<RenameDialog />
<ConflictDialog />
<Toaster />
