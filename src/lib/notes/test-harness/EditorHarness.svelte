<script lang="ts">
	import ConfirmDialog from "$lib/components/dialogs/ConfirmDialog.svelte";
	import LazyDialogs from "$lib/components/dialogs/LazyDialogs.svelte";
	import { openNoteEditor } from "$lib/components/dialogs/lazy.svelte";

	// As in the app root: the lazily loaded dialogs, and a button that opens the editor.
	let { widgetId }: { widgetId: string } = $props();
</script>

<button type="button" onclick={() => openNoteEditor({ widgetId })}>Open the editor</button>
<LazyDialogs />
<ConfirmDialog />
