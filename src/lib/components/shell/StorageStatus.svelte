<script lang="ts">
	import { downloadBackupFile } from "$lib/actions/dashboard";
	import { openClearData } from "$lib/components/dialogs/ClearDataDialog.svelte";
	import { Button } from "$lib/components/ui/button";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import type { SaveErrorKind } from "$lib/store/document-session.svelte";

	let {
		errorKind = null,
		clearable = false
	}: { errorKind?: SaveErrorKind | null; clearable?: boolean } = $props();

	const app = useApp();
	const protection = app.protection;
	const unprotected = $derived(protection.state !== "protected");
	const hasDashboards = $derived(app.index.items.length > 0);
</script>

<div class="flex flex-col gap-2">
	{#if errorKind}
		<p class="text-destructive">
			{errorKind === "quota" ? m.save_failed_quota() : m.save_failed_unavailable()}
		</p>
	{/if}
	<p>{m.storage_note()}</p>
	{#if unprotected && protection.ready}
		<p class="text-muted-foreground">{m.storage_note_unprotected()}</p>
	{/if}
	{#if (unprotected && hasDashboards) || errorKind}
		<Button variant="link" class="h-auto justify-start p-0" onclick={() => downloadBackupFile(app)}>
			{m.backup_download()}
		</Button>
	{/if}
	{#if protection.canOffer}
		<Button variant="outline" size="sm" onclick={() => protection.requestByClick()}>
			{m.protect_button()}
		</Button>
	{/if}
	{#if clearable}
		<Button variant="outline" size="sm" onclick={openClearData}>{m.clear_data_button()}</Button>
	{/if}
</div>
