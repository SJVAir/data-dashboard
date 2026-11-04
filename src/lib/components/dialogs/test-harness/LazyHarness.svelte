<script lang="ts">
	import ConfirmDialog from "../ConfirmDialog.svelte";
	import LazyDialogs from "../LazyDialogs.svelte";
	import { openShare } from "../lazy.svelte";

	// As in the app root: the lazily loaded dialogs, then the confirm dialog that opens over them.
	let { url }: { url: string } = $props();
</script>

<button
	type="button"
	onclick={() => openShare({ url, linkUnavailable: null, onDownload() {}, live: null })}
>
	Share
</button>
<LazyDialogs />
<ConfirmDialog />
