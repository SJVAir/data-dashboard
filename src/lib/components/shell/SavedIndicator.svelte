<script lang="ts">
	import Cloud from "@lucide/svelte/icons/cloud";
	import HardDrive from "@lucide/svelte/icons/hard-drive";
	import Info from "@lucide/svelte/icons/info";
	import { announce } from "$lib/a11y/announcer.svelte";
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
	// A conflict (another version of this dashboard to choose from, here or on the account) isn't a
	// failure: it gets its own label and the neutral style.
	const conflicted = $derived(
		status !== null &&
			(!!app.current.session?.conflict || (inAccount && syncState?.hold?.kind === "conflict"))
	);
	const label = $derived(
		conflicted
			? m.save_conflict()
			: status === "saving"
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
	const errorKind = $derived(
		status === "error" && !conflicted ? (app.current.session?.errorKind ?? null) : null
	);

	// Screen readers hear only the changes that matter, not every save. Changes are measured from
	// the last settled state, so "Saving..." in between (each retry) doesn't count, and they start
	// over when another dashboard opens.
	const kind = $derived(conflicted ? "conflict" : status);
	let previous: typeof kind | undefined;
	let previousSession: unknown;
	$effect(() => {
		const now = kind;
		const session = app.current.session;
		if (session !== previousSession) {
			previousSession = session;
			// A save already under way counts from "saved", so its failure is still heard.
			previous = now === "saving" ? "saved" : undefined;
		}
		if (now === "saving") return;
		const was = previous;
		previous = now;
		if (was === undefined || was === now) return;
		if (now === "conflict") announce(m.save_conflict_announce());
		else if (now === "error") announce(m.save_failed());
		else if (now === "saved" && (was === "error" || was === "conflict"))
			announce(m.save_recovered());
	});
</script>

<Popover.Root>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="sm"
				class={status === "error" && !conflicted ? "text-destructive" : "text-muted-foreground"}
			>
				{#if conflicted}
					<Info aria-hidden="true" />
				{:else if status === "saved" && onAccount}
					<Cloud aria-hidden="true" />
				{:else}
					<HardDrive aria-hidden="true" />
				{/if}
				<span>{label}</span>
				<span class="sr-only">{m.storage_status_label()}</span>
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="end">
		<StorageStatus {errorKind} sync={syncState} clearable />
	</Popover.Content>
</Popover.Root>
