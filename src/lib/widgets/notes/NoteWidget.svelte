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
	import { FIT_CONTENT_KEY, type FitContent } from "../shared/context";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "../shared/viewer";
	import NoteBlocks from "./NoteBlocks.svelte";

	let { widget, fullscreen = false }: { widget: WidgetInstance; fullscreen?: boolean } = $props();

	const viewer = getContext<PlaceViewer | undefined>(PLACE_VIEWER_KEY) ?? "owner";

	const app = getContext<AppContext | undefined>(APP_CONTEXT_KEY);
	// The hint invites an edit, so it shows only where the dashboard can be edited right now.
	const editable = $derived(
		viewer === "owner" && !!app?.current.session && !app.current.session.readOnly
	);

	const options = $derived(noteOptions(widget));
	// A built-in message is written for the owner, so a view that can't edit shows nothing.
	const markdown = $derived("message" in options && !editable ? "" : noteMarkdown(options));
	const blocks = $derived(toNoteBlocks(markdown));

	const fit = getContext<FitContent | undefined>(FIT_CONTENT_KEY);
	/**
	 * Reports the text's natural height (it grows to fit on a phone). It measures the content,
	 * not the scroller, so the frame growing doesn't feed back; it changes with the text, the
	 * width (rotation, resizing), and fonts loading. Below the phone breakpoint the scrollbar's
	 * gutter is always kept, so the text's width (and height) doesn't change when it starts or
	 * stops scrolling: no flip-flop between two row counts with classic scrollbars.
	 */
	function measure(content: HTMLElement) {
		if (!fit) return;
		const scroller = content.parentElement;
		const observer = new ResizeObserver(([entry]) => {
			// The layout box, not the client rect: a FLIP transform doesn't skew it.
			const height = entry.borderBoxSize?.[0]?.blockSize ?? content.offsetHeight;
			const style = scroller ? getComputedStyle(scroller) : null;
			const padding = style ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) : 0;
			fit(height + padding);
		});
		observer.observe(content);
		return () => {
			observer.disconnect();
			fit(null);
		};
	}

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
	class="h-full overflow-y-auto p-3 text-sm max-md:[scrollbar-gutter:stable]"
	data-widget={widget.id}
	data-fullscreen={fullscreen}
	tabindex="0"
	role="region"
	aria-label={widget.title ?? m.widget_note_title()}
	{ondblclick}
>
	<div class="flex flex-col gap-2" {@attach measure}>
		{#if blocks.length > 0}
			<NoteBlocks {blocks} />
		{:else if editable}
			<p class="text-muted-foreground">{m.note_empty_hint()}</p>
		{/if}
	</div>
</div>
