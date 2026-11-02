<script lang="ts">
	import Cloud from "@lucide/svelte/icons/cloud";
	import HardDrive from "@lucide/svelte/icons/hard-drive";
	import { Button } from "$lib/components/ui/button";
	import * as Popover from "$lib/components/ui/popover";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import StorageStatus from "./StorageStatus.svelte";

	const app = useApp();

	// Only an editable, stored dashboard has a save status (the starter is never stored).
	const status = $derived.by(() => {
		const { session, isStarter } = app.current;
		return session && !isStarter && !session.readOnly ? session.status : null;
	});
	// Where it's saved, in an account space: the account has it only once synced (no state yet
	// means it hasn't been uploaded).
	const inAccount = $derived(app.space !== "anonymous");
	const syncState = $derived.by(() => {
		const { session } = app.current;
		return inAccount && session ? (app.sync?.states[session.doc.id] ?? null) : null;
	});
	const onAccount = $derived(syncState?.state === "synced");
	const label = $derived(
		status === "saving"
			? m.saving()
			: status === "error"
				? m.save_failed()
				: status === "saved"
					? inAccount
						? onAccount
							? m.saved_account()
							: m.saved_device()
						: m.saved()
					: ""
	);
	const errorKind = $derived(status === "error" ? (app.current.session?.errorKind ?? null) : null);
</script>

<Popover.Root>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="sm"
				class={status === "error" ? "text-destructive" : "text-muted-foreground"}
			>
				{#if status === "saved" && onAccount}
					<Cloud aria-hidden="true" />
				{:else}
					<HardDrive aria-hidden="true" />
				{/if}
				<span aria-live="polite">{label}</span>
				<span class="sr-only">{m.storage_status_label()}</span>
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="end">
		<StorageStatus {errorKind} sync={syncState} clearable />
	</Popover.Content>
</Popover.Root>
