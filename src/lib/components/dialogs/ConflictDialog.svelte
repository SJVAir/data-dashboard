<script lang="ts">
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import type { ConflictChoice } from "$lib/store/document-session.svelte";
	import { navigate } from "../../../router";

	const app = useApp();
	const session = $derived(app.current.session);
	/** A conflict with another device, held by sync (another tab's conflict is asked first). */
	const device = $derived(
		!!session && !session.conflict && app.sync?.states[session.doc.id]?.hold?.kind === "conflict"
	);
	let busy = $state(false);

	async function choose(choice: ConflictChoice) {
		if (!session || busy) return;
		busy = true;
		try {
			let copyId: string | null = null;
			if (session.conflict) copyId = await session.resolveConflict(choice);
			else if (device && app.sync) {
				// The choice settles what's stored, so this tab's edits are stored first.
				await session.flush();
				copyId = await app.sync.resolve(session.doc.id, choice);
				// The document under the undo history was replaced.
				if (choice !== "keep-mine") session.clearHistory();
			}
			if (copyId) await navigate("/dashboards/:id", { params: { id: copyId } });
		} catch {
			toast.error(m.conflict_failed());
		} finally {
			busy = false;
		}
	}
</script>

<!-- Only a choice closes it: outside clicks and Escape are ignored. -->
<Dialog.Root open={!!session?.conflict || device}>
	<Dialog.Content
		showCloseButton={false}
		interactOutsideBehavior="ignore"
		escapeKeydownBehavior="ignore"
	>
		<Dialog.Header>
			<Dialog.Title>{device ? m.conflict_title_device() : m.conflict_title()}</Dialog.Title>
			<Dialog.Description>
				{device ? m.conflict_body_device() : m.conflict_body()}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button disabled={busy} onclick={() => choose("keep-mine")}>{m.conflict_keep_mine()}</Button>
			<Button variant="outline" disabled={busy} onclick={() => choose("use-other")}>
				{m.conflict_use_other()}
			</Button>
			<Button variant="outline" disabled={busy} onclick={() => choose("save-copy")}>
				{m.conflict_save_copy()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
