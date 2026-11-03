<script lang="ts">
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import type { RemoteChoice } from "$lib/sync/resolve";
	import { navigate } from "../../../router";

	const app = useApp();
	const session = $derived(app.current.session);
	/** The open dashboard was deleted on another device, or permanently deleted, with edits here. */
	const kind = $derived.by(() => {
		const hold = session ? app.sync?.states[session.doc.id]?.hold : null;
		return hold?.kind === "deleted-elsewhere" || hold?.kind === "gone" ? hold.kind : null;
	});
	let busy = $state(false);

	async function choose(choice: RemoteChoice) {
		if (!session || !app.sync || !kind || busy) return;
		const removed = kind === "gone";
		busy = true;
		try {
			// The choice settles what's stored, so this tab's edits are stored first.
			await session.flush();
			const newId = await app.sync.resolve(session.doc.id, choice);
			if (choice === "discard") session.clearHistory();
			if (newId) {
				await navigate("/dashboards/:id", { params: { id: newId }, replace: true });
			} else if (removed && choice === "discard") {
				await app.index.refresh();
				await navigate("/", { replace: true });
			}
			// Discarding after a delete elsewhere stores it deleted: the page leaves it as for Delete.
		} catch {
			toast.error(m.conflict_failed());
		} finally {
			busy = false;
		}
	}
</script>

<!-- Only a choice closes it: outside clicks and Escape are ignored. -->
<Dialog.Root open={kind !== null}>
	<Dialog.Content
		showCloseButton={false}
		interactOutsideBehavior="ignore"
		escapeKeydownBehavior="ignore"
	>
		{#if kind === "gone"}
			<Dialog.Header>
				<Dialog.Title>{m.purged_title()}</Dialog.Title>
				<Dialog.Description>{m.purged_body()}</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button disabled={busy} onclick={() => choose("keep-as-new")}>{m.purged_keep()}</Button>
				<Button variant="outline" disabled={busy} onclick={() => choose("discard")}>
					{m.purged_discard()}
				</Button>
			</Dialog.Footer>
		{:else}
			<Dialog.Header>
				<Dialog.Title>{m.deleted_elsewhere_title()}</Dialog.Title>
				<Dialog.Description>{m.deleted_elsewhere_body()}</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button disabled={busy} onclick={() => choose("restore")}>
					{m.deleted_elsewhere_restore()}
				</Button>
				<Button variant="outline" disabled={busy} onclick={() => choose("discard")}>
					{m.deleted_elsewhere_discard()}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
