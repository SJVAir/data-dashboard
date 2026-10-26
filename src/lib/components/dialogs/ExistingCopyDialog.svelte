<script module lang="ts">
	import type { DashboardSummary } from "$lib/documents/names";

	export type ExistingCopyChoice = "open" | "new";

	const ask = $state<{ open: boolean; copy: DashboardSummary | null }>({ open: false, copy: null });
	let resolver: ((choice: ExistingCopyChoice | null) => void) | null = null;

	function settle(choice: ExistingCopyChoice | null): void {
		ask.open = false;
		const resolve = resolver;
		resolver = null;
		resolve?.(choice);
	}

	/** Asks what to do about a copy already made (one dialog is mounted in the app root). */
	export function askExistingCopy(copy: DashboardSummary): Promise<ExistingCopyChoice | null> {
		settle(null);
		ask.copy = copy;
		ask.open = true;
		return new Promise((resolve) => (resolver = resolve));
	}
</script>

<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { formatDate } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
</script>

<!-- Closing it any other way (Escape, outside click) is no choice: it resolves `null`. -->
<Dialog.Root
	bind:open={ask.open}
	onOpenChange={(open) => {
		if (!open) settle(null);
	}}
>
	<Dialog.Content showCloseButton={false}>
		<Dialog.Header>
			<Dialog.Title>{m.existing_copy_title()}</Dialog.Title>
			{#if ask.copy}
				<Dialog.Description>
					{m.existing_copy_changed({ date: formatDate(new Date(ask.copy.updatedAt)) })}
				</Dialog.Description>
			{/if}
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => settle("open")}>{m.existing_copy_open()}</Button>
			<Button variant="outline" onclick={() => settle("new")}>{m.existing_copy_new()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
