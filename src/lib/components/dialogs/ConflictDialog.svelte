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
	let busy = $state(false);

	async function choose(choice: ConflictChoice) {
		if (!session || busy) return;
		busy = true;
		try {
			const copyId = await session.resolveConflict(choice);
			if (copyId) await navigate("/dashboards/:id", { params: { id: copyId } });
		} catch {
			toast.error(m.conflict_failed());
		} finally {
			busy = false;
		}
	}
</script>

<!-- Only a choice closes it: outside clicks and Escape are ignored. -->
<Dialog.Root open={!!session?.conflict}>
	<Dialog.Content
		showCloseButton={false}
		interactOutsideBehavior="ignore"
		escapeKeydownBehavior="ignore"
	>
		<Dialog.Header>
			<Dialog.Title>{m.conflict_title()}</Dialog.Title>
			<Dialog.Description>{m.conflict_body()}</Dialog.Description>
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
