<script lang="ts">
	import { downloadBackupFile } from "$lib/actions/dashboard";
	import { openClearData } from "$lib/components/dialogs/lazy.svelte";
	import { Button } from "$lib/components/ui/button";
	import { formatDateTime } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import type { SaveErrorKind } from "$lib/store/document-session.svelte";
	import type { DocSyncState } from "$lib/sync/worker.svelte";
	import { refusedMessage } from "./sync-messages";

	let {
		errorKind = null,
		sync = null,
		clearable = false
	}: {
		errorKind?: SaveErrorKind | null;
		/** The open dashboard's place with the account (account spaces only). */
		sync?: DocSyncState | null;
		clearable?: boolean;
	} = $props();

	const app = useApp();
	const protection = app.protection;
	const unprotected = $derived(protection.state !== "protected");
	const hasDashboards = $derived(app.index.items.length > 0);
	/** Signed in: the account keeps the dashboards, so the browser's storage notes don't apply. */
	const local = app.space === "anonymous";
</script>

<div class="flex flex-col gap-2">
	{#if errorKind}
		<p class="text-destructive">
			{errorKind === "quota" ? m.save_failed_quota() : m.save_failed_unavailable()}
		</p>
	{/if}
	{#if sync?.hold?.kind === "refused"}
		<p class="text-destructive">{refusedMessage(sync.hold.code)}</p>
	{/if}
	{#if sync?.confirmedAt}
		<p>{m.sync_confirmed_at({ time: formatDateTime(new Date(sync.confirmedAt)) })}</p>
	{/if}
	<p>{local ? m.storage_note() : m.storage_note_account()}</p>
	{#if local && unprotected && protection.ready}
		<p class="text-muted-foreground">{m.storage_note_unprotected()}</p>
	{/if}
	{#if (local && unprotected && hasDashboards) || errorKind}
		<Button variant="link" class="h-auto justify-start p-0" onclick={() => downloadBackupFile(app)}>
			{m.backup_download()}
		</Button>
	{/if}
	{#if local && protection.canOffer}
		<Button variant="outline" size="sm" onclick={() => protection.requestByClick()}>
			{m.protect_button()}
		</Button>
	{/if}
	{#if clearable}
		<Button variant="outline" size="sm" onclick={openClearData}>{m.clear_data_button()}</Button>
	{/if}
</div>
