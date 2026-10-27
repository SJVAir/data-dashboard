<script lang="ts">
	import { Router } from "sv-router";
	import ClearDataDialog from "$lib/components/dialogs/ClearDataDialog.svelte";
	import ConfirmDialog from "$lib/components/dialogs/ConfirmDialog.svelte";
	import ConflictDialog from "$lib/components/dialogs/ConflictDialog.svelte";
	import ExistingCopyDialog from "$lib/components/dialogs/ExistingCopyDialog.svelte";
	import PrivacyDialog from "$lib/components/dialogs/PrivacyDialog.svelte";
	import ShareDialog from "$lib/components/dialogs/ShareDialog.svelte";
	import RestoreVersionDialog from "$lib/components/dialogs/RestoreVersionDialog.svelte";
	import RenameDialog from "$lib/components/dialogs/RenameDialog.svelte";
	import NoticeBars from "$lib/components/shell/NoticeBars.svelte";
	import TopNav from "$lib/components/shell/TopNav.svelte";
	import { Toaster } from "$lib/components/ui/sonner";
	import { useApp } from "$lib/store/app.svelte";
	// Imported for its side effect too: it sets up the route table.
	import { navigate } from "./router";

	const app = useApp();
	let resets = app.resetCount;

	// This browser's data was cleared: start over on the starter, as a first visit would.
	$effect(() => {
		if (app.resetCount === resets) return;
		resets = app.resetCount;
		void navigate("/", { replace: true });
	});
</script>

<div class="flex min-h-dvh flex-col">
	<TopNav />
	<NoticeBars />
	<main class="flex-1">
		<Router />
	</main>
</div>
<RenameDialog />
<ConfirmDialog />
<ClearDataDialog />
<ConflictDialog />
<ExistingCopyDialog />
<ShareDialog />
<PrivacyDialog />
<RestoreVersionDialog />
<Toaster />
