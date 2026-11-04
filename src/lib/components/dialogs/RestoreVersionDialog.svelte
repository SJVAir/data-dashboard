<script module lang="ts">
	import type {
		AccountStatus,
		EarlierVersion,
		EarlierVersions,
		RestoreResult
	} from "$lib/safety/restore-version";

	type RestoreState = {
		open: boolean;
		loading: boolean;
		versions: EarlierVersion[];
		account: AccountStatus;
		selected: number;
		restore: ((version: EarlierVersion) => Promise<RestoreResult>) | null;
		failure: RestoreResult | null;
	};

	const restoring = $state<RestoreState>({
		open: false,
		loading: false,
		versions: [],
		account: "none",
		selected: 0,
		restore: null,
		failure: null
	});

	let opening = 0;

	/** Closing starts over: the next opening shows a fresh list. */
	function reset(): void {
		opening++;
		restoring.versions = [];
		restoring.account = "none";
		restoring.selected = 0;
		restoring.restore = null;
		restoring.failure = null;
		restoring.loading = false;
	}

	/**
	 * Opens the Restore dialog (one is mounted in the app root). `load` lists the earlier
	 * versions, newest first; `restore` applies the chosen one and says how it went. The dialog
	 * closes only when it says `"restored"`.
	 */
	export function openRestoreVersion(
		load: () => Promise<EarlierVersions>,
		restore: (version: EarlierVersion) => Promise<RestoreResult>
	): void {
		const mine = ++opening;
		restoring.versions = [];
		restoring.account = "none";
		restoring.selected = 0;
		restoring.restore = restore;
		restoring.failure = null;
		restoring.loading = true;
		restoring.open = true;
		load()
			.then((loaded) => {
				if (mine !== opening) return;
				restoring.versions = loaded.versions;
				restoring.account = loaded.account;
			})
			.catch(() => {
				if (mine !== opening) return;
				restoring.account = "offline";
			})
			.finally(() => {
				if (mine === opening) restoring.loading = false;
			});
	}
</script>

<script lang="ts">
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

	function failureMessage(failure: RestoreResult | null): string {
		switch (failure) {
			case null:
			case "restored":
				return "";
			case "newer":
				return m.restore_version_newer();
			case "unreachable":
				return m.restore_version_unreachable();
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

<Dialog.Root open={restoring.open} {onOpenChange}>
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
		{:else}
			<p class="text-muted-foreground text-sm">{m.restore_version_none()}</p>
		{/if}
		{#if !restoring.loading && restoring.account === "offline"}
			<p class="text-muted-foreground text-sm">{m.restore_version_account_offline()}</p>
		{:else if !restoring.loading && restoring.account === "gone"}
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
