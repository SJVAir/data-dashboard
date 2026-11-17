<script lang="ts" module>
	/** One map note: its message, its `data-*` hook, and a button when there's something to do. */
	export type MapNoteProps = {
		message: string;
		hook: string;
		action?: { label: string; onclick: () => void };
	};
</script>

<script lang="ts">
	import { Button } from "$lib/components/ui/button";

	/**
	 * One of the map's compact notes under the toolbar: a message, and a button when there's
	 * something to do about it (Retry, Edit data). `hook` names its `data-*` attribute.
	 */
	let { message, hook, action }: MapNoteProps = $props();
</script>

<div
	class="bg-card text-card-foreground border-border shadow-card mx-auto flex max-w-96 items-center gap-2 rounded-(--radius-control) border px-3 py-2 text-sm"
	role="status"
	{...{ [`data-${hook}`]: "" }}
>
	<p class="text-muted-foreground">{message}</p>
	{#if action}
		<Button size="sm" variant="outline" class="pointer-events-auto" onclick={action.onclick}>
			{action.label}
		</Button>
	{/if}
</div>
