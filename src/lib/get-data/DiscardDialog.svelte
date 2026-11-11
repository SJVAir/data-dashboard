<script lang="ts">
	import { AlertDialog } from "bits-ui";
	import LiveRegion from "$lib/components/a11y/LiveRegion.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { m } from "$lib/paraglide/messages.js";

	let {
		open,
		ondecide,
		onCloseAutoFocus
	}: {
		open: boolean;
		/** True for "Discard"; false for "Keep editing" or closing the dialog. */
		ondecide: (discard: boolean) => void;
		/** Where focus goes once it has closed (by default, back to what had it before). */
		onCloseAutoFocus?: (event: Event) => void;
	} = $props();
</script>

<!-- "Discard changes?" when leaving Edit data with unsaved changes (the alert dialog pattern). -->
<AlertDialog.Root
	{open}
	onOpenChange={(next) => {
		if (!next) ondecide(false);
	}}
>
	<AlertDialog.Portal>
		<Dialog.Overlay />
		<AlertDialog.Content
			{onCloseAutoFocus}
			class="bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 border-card-border shadow-card duration-fast ease-standard fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%_-_2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-4 text-sm outline-none sm:max-w-sm"
		>
			<Dialog.Header>
				<Dialog.Title>{m.get_data_discard_title()}</Dialog.Title>
			</Dialog.Header>
			<Dialog.Footer>
				<AlertDialog.Cancel>
					{#snippet child({ props })}
						<Button variant="outline" {...props} onclick={() => ondecide(false)}>
							{m.get_data_keep_editing()}
						</Button>
					{/snippet}
				</AlertDialog.Cancel>
				<AlertDialog.Action>
					{#snippet child({ props })}
						<Button variant="destructive" {...props} onclick={() => ondecide(true)}>
							{m.get_data_discard()}
						</Button>
					{/snippet}
				</AlertDialog.Action>
			</Dialog.Footer>
			<!-- The page's live region is cut off while this modal is open. -->
			<LiveRegion layer="dialog" {open} />
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>
