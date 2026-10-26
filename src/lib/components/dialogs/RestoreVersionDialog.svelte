<script module lang="ts">
	import type { KeptOriginal } from "$lib/platform/types";

	type RestoreState = {
		open: boolean;
		original: KeptOriginal | null;
		restore: (() => Promise<boolean>) | null;
		failed: boolean;
	};

	const restoring = $state<RestoreState>({
		open: false,
		original: null,
		restore: null,
		failed: false
	});

	/**
	 * Opens the Restore dialog for a kept original (one is mounted in the app root). `restore`
	 * does the work and says whether it worked; the dialog closes only on success.
	 */
	export function openRestoreVersion(
		original: KeptOriginal,
		restore: () => Promise<boolean>
	): void {
		restoring.original = original;
		restoring.restore = restore;
		restoring.failed = false;
		restoring.open = true;
	}
</script>

<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { formatDate } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";

	let busy = $state(false);

	async function confirm() {
		if (!restoring.restore || busy) return;
		busy = true;
		try {
			restoring.failed = !(await restoring.restore());
		} catch {
			restoring.failed = true;
		} finally {
			busy = false;
		}
		if (!restoring.failed) restoring.open = false;
	}
</script>

<Dialog.Root bind:open={restoring.open}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.restore_version_title()}</Dialog.Title>
			<Dialog.Description>
				{restoring.original
					? m.restore_version_item({ date: formatDate(new Date(restoring.original.keptAt)) })
					: ""}
			</Dialog.Description>
		</Dialog.Header>
		<p role="alert" class="text-destructive text-sm">
			{restoring.failed ? m.restore_version_failed() : ""}
		</p>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (restoring.open = false)}
				>{m.confirm_cancel()}</Button
			>
			<Button disabled={busy} onclick={confirm}>{m.restore_version_confirm()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
