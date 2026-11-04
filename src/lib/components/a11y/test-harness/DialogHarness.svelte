<script lang="ts">
	import LiveRegion from "$lib/components/a11y/LiveRegion.svelte";
	import * as Dialog from "$lib/components/ui/dialog";

	// A dialog with a second one that opens over it, beside the page's live region.
	let outer = $state(false);
	let inner = $state(false);
</script>

<button type="button" onclick={() => (outer = true)}>Open outer</button>
<Dialog.Root bind:open={outer}>
	<Dialog.Content>
		<Dialog.Title>Outer</Dialog.Title>
		<button type="button" onclick={() => (inner = true)}>Open inner</button>
	</Dialog.Content>
</Dialog.Root>
<Dialog.Root bind:open={inner}>
	<Dialog.Content>
		<Dialog.Title>Inner</Dialog.Title>
	</Dialog.Content>
</Dialog.Root>
<LiveRegion />
