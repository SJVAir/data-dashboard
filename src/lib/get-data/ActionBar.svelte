<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { m } from "$lib/paraglide/messages.js";

	let {
		downloading,
		ondownload,
		oncancel,
		onadd,
		onsave
	}: {
		/** A CSV of the draft is being prepared. */
		downloading: boolean;
		ondownload: () => void;
		oncancel: () => void;
		/** Shown as "Add to dashboard" when given. */
		onadd?: () => void;
		/** Shown as "Save changes" when given. */
		onsave?: () => void;
	} = $props();
</script>

<div
	class="bg-card border-card-border sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t px-3 py-2"
>
	<Button variant="ghost" onclick={oncancel}>{m.get_data_cancel()}</Button>
	<Button variant="outline" disabled={downloading} onclick={ondownload}>
		{m.get_data_download_csv()}
	</Button>
	{#if onsave}
		<Button onclick={onsave}>{m.get_data_save()}</Button>
	{:else if onadd}
		<Button onclick={onadd}>{m.get_data_add()}</Button>
	{/if}
</div>
