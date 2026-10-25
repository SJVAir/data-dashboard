<script lang="ts">
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
	const label = $derived(
		status === "saving"
			? m.saving()
			: status === "error"
				? m.save_failed()
				: status === "saved"
					? m.saved()
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
				<HardDrive aria-hidden="true" />
				<span aria-live="polite">{label}</span>
				<span class="sr-only">{m.storage_status_label()}</span>
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="end">
		<StorageStatus {errorKind} clearable />
	</Popover.Content>
</Popover.Root>
