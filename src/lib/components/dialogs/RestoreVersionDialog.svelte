<script lang="ts">
	import type { AccountStatus, EarlierVersion, RestoreResult } from "$lib/safety/restore-version";
	import { resetRestoreVersion as reset, restoring } from "./lazy.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { formatDateTime } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";

	let busy = $state(false);
	let list = $state<HTMLFieldSetElement | null>(null);

	// When the list arrives, focus moves to the first radio.
	$effect(() => {
		if (!restoring.loading && list) list.querySelector<HTMLInputElement>("input")?.focus();
	});

	function onOpenChange(open: boolean) {
		if (!open && busy) return;
		restoring.open = open;
		if (!open) reset();
	}

	function label(version: EarlierVersion): string {
		const date = formatDateTime(new Date(version.at));
		if (version.source === "local") {
			return version.alsoInAccount
				? m.restore_version_local_and_account({ date })
				: m.restore_version_local({ date });
		}
		if (version.reason === "schema") return m.restore_version_schema({ date });
		if (version.reason === "daily") return m.restore_version_daily({ date });
		return m.restore_version_conflict({ date });
	}

	/** The one line for an empty list: what "nothing here" means depends on the account. */
	function emptyMessage(account: AccountStatus): string {
		switch (account) {
			case "ok":
				return m.restore_version_none();
			case "gone":
				return m.restore_version_account_gone_none();
			case "offline":
			case "unavailable":
				return m.restore_version_none_device();
			default:
				return m.restore_version_none_local();
		}
	}

	function failureMessage(failure: RestoreResult | null): string {
		switch (failure) {
			case null:
			case "restored":
				return "";
			case "newer":
				return m.restore_version_newer();
			case "unreachable":
				return m.restore_version_unreachable();
			case "unavailable":
				return m.restore_version_unavailable();
			default:
				return m.restore_version_failed();
		}
	}

	async function confirm() {
		const version = restoring.versions[restoring.selected];
		if (!restoring.restore || !version || busy) return;
		busy = true;
		try {
			restoring.failure = await restoring.restore(version);
		} catch {
			restoring.failure = "unreadable";
		} finally {
			busy = false;
		}
		if (restoring.failure === "restored") onOpenChange(false);
	}
</script>

<!-- A function binding: bits-ui sets its own `open` before calling `onOpenChange`, so refusing
	there wouldn't keep the dialog open during a restore. -->
<Dialog.Root bind:open={() => restoring.open, (open) => onOpenChange(open)}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.restore_version_title()}</Dialog.Title>
			<Dialog.Description class="sr-only">{m.restore_version_legend()}</Dialog.Description>
		</Dialog.Header>
		<p class="text-muted-foreground text-sm" role="status">
			{restoring.loading ? m.restore_version_loading() : ""}
		</p>
		{#if restoring.loading}
			<!-- The status line above holds the loading text. -->
		{:else if restoring.versions.length > 0}
			<fieldset class="flex flex-col gap-2" bind:this={list}>
				<legend class="mb-2 text-sm font-medium">{m.restore_version_legend()}</legend>
				{#each restoring.versions as version, i (i)}
					<label class="flex items-start gap-2 text-sm">
						<input
							type="radio"
							name="earlier-version"
							class="mt-1"
							value={i}
							checked={restoring.selected === i}
							onchange={() => (restoring.selected = i)}
						/>
						<span>{label(version)}</span>
					</label>
				{/each}
			</fieldset>
		{:else if restoring.loadFailed}
			<p class="text-muted-foreground text-sm">{m.restore_version_load_failed()}</p>
		{:else}
			<p class="text-muted-foreground text-sm">{emptyMessage(restoring.account)}</p>
		{/if}
		{#if !restoring.loading && restoring.account === "offline"}
			<p class="text-muted-foreground text-sm">{m.restore_version_account_offline()}</p>
		{:else if !restoring.loading && restoring.account === "unavailable"}
			<p class="text-muted-foreground text-sm">{m.restore_version_account_unavailable()}</p>
		{:else if !restoring.loading && restoring.account === "gone" && restoring.versions.length > 0}
			<p class="text-muted-foreground text-sm">{m.restore_version_account_gone()}</p>
		{/if}
		<p role="alert" class="text-destructive text-sm">{failureMessage(restoring.failure)}</p>
		<Dialog.Footer>
			<Button variant="outline" disabled={busy} onclick={() => onOpenChange(false)}
				>{m.confirm_cancel()}</Button
			>
			<Button
				disabled={busy || restoring.loading || restoring.versions.length === 0}
				onclick={confirm}>{m.restore_version_confirm()}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
