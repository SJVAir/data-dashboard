<script lang="ts">
	import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
	import type { QueryState } from "$lib/data/types";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { m } from "$lib/paraglide/messages.js";
	import WidgetState from "../shared/WidgetState.svelte";
	import MapNote, { type MapNoteProps } from "./MapNote.svelte";

	/**
	 * The map's compact notes under the toolbar: why the places can't all be shown (or that no
	 * monitor there reports the pollutant), then each layer's note. The map stays usable, but for
	 * their buttons.
	 */
	let {
		widget,
		place,
		noMonitors,
		onDay,
		onretry,
		notes
	}: {
		widget: WidgetInstance;
		/** Why the places can't all be shown, over a map that still draws. */
		place: QueryState | null;
		/** The places are scoped and loaded, but no monitor there reports the pollutant showing. */
		noMonitors: boolean;
		onDay: boolean;
		/** The place note's Retry. */
		onretry: () => void;
		/** The layers' notes, in order; each `hook` is unique. */
		notes: readonly MapNoteProps[];
	} = $props();
</script>

{#snippet nothing()}{/snippet}

{#if place || noMonitors || notes.length}
	<div
		class="pointer-events-none absolute inset-x-0 top-[var(--mapsdk-toolbar-height,0px)] flex flex-col gap-1 p-2"
		data-map-note
	>
		{#if place}
			<div
				class="bg-card text-card-foreground border-border shadow-card mx-auto max-w-96 rounded-(--radius-control) border px-3 py-2 [&_button]:pointer-events-auto"
			>
				<WidgetState
					state={place}
					{widget}
					{onretry}
					onchoose={() => openPlacePicker({ widgetId: widget.id })}
					children={nothing}
				/>
			</div>
		{:else if noMonitors}
			<p
				class="bg-card text-muted-foreground border-border shadow-card mx-auto max-w-96 rounded-(--radius-control) border px-3 py-2 text-center text-sm"
				role="status"
			>
				{onDay ? m.map_no_monitors_here_day() : m.map_no_monitors_here()}
			</p>
		{/if}
		{#each notes as note (note.hook)}
			<MapNote {...note} />
		{/each}
	</div>
{/if}
