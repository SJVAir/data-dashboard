<script lang="ts">
	import { getContext } from "svelte";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { noteMarkdown } from "$lib/notes/messages";
	import { toNoteBlocks } from "$lib/notes/markdown";
	import { noteOptions } from "$lib/notes/options";
	import { m } from "$lib/paraglide/messages.js";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "../shared/viewer";
	import NoteBlocks from "./NoteBlocks.svelte";

	let { widget, fullscreen = false }: { widget: WidgetInstance; fullscreen?: boolean } = $props();

	const viewer = getContext<PlaceViewer | undefined>(PLACE_VIEWER_KEY) ?? "owner";

	const markdown = $derived(noteMarkdown(noteOptions(widget)));
	const blocks = $derived(toNoteBlocks(markdown));
</script>

<!-- Scrolls inside the widget; focusable so a keyboard can scroll it. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="flex h-full flex-col gap-2 overflow-y-auto p-3 text-sm"
	data-widget={widget.id}
	data-fullscreen={fullscreen}
	tabindex="0"
	role="region"
	aria-label={widget.title ?? m.widget_note_title()}
>
	{#if blocks.length > 0}
		<NoteBlocks {blocks} />
	{:else if viewer === "owner"}
		<p class="text-muted-foreground">{m.note_empty_hint()}</p>
	{/if}
</div>
