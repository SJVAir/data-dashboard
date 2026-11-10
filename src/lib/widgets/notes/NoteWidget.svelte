<script lang="ts">
	import { getContext } from "svelte";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { noteMarkdown } from "$lib/notes/messages";
	import { toNoteBlocks } from "$lib/notes/markdown";
	import { APP_CONTEXT_KEY, type AppContext } from "$lib/store/app.svelte";
	import { noteOptions } from "$lib/notes/options";
	import { openNoteEditor } from "$lib/components/dialogs/lazy.svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { noteEditable } from "./index";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "../shared/viewer";
	import NoteBlocks from "./NoteBlocks.svelte";

	let { widget, fullscreen = false }: { widget: WidgetInstance; fullscreen?: boolean } = $props();

	const viewer = getContext<PlaceViewer | undefined>(PLACE_VIEWER_KEY) ?? "owner";

	const app = getContext<AppContext | undefined>(APP_CONTEXT_KEY);
	// The hint invites an edit, so it shows only where the dashboard can be edited right now.
	const editable = $derived(
		viewer === "owner" && !!app?.current.session && !app.current.session.readOnly
	);

	const markdown = $derived(noteMarkdown(noteOptions(widget)));
	const blocks = $derived(toNoteBlocks(markdown));

	/** Double-clicking an empty Note that can be edited opens its editor. */
	function ondblclick(): void {
		if (blocks.length === 0 && editable && noteEditable(app, widget.id)) {
			openNoteEditor({ widgetId: widget.id });
		}
	}
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
	{ondblclick}
>
	{#if blocks.length > 0}
		<NoteBlocks {blocks} />
	{:else if editable}
		<p class="text-muted-foreground">{m.note_empty_hint()}</p>
	{/if}
</div>
