<script lang="ts" module>
	import type { PesticideNote } from "@sjvair/sdk";

	import { resetFiltersLines } from "./filters-line.svelte";

	/**
	 * The last ready server notes, kept across a remount (a new plugin after a zoom, figure or
	 * period change draws the note again); the filters' names are kept by `filtersLine`.
	 */
	let lastNotes: PesticideNote[] | null = null;

	/** Forgets the kept lines (for tests). */
	export function resetUseLegendNote(): void {
		lastNotes = null;
		resetFiltersLines();
	}
</script>

<script lang="ts">
	import ExternalLinkCue from "$lib/components/shared/ExternalLinkCue.svelte";
	import { pesticideMeta } from "$lib/data/pesticide-meta";
	import type { PesticideFilters } from "$lib/data/schema";
	import { m } from "$lib/paraglide/messages.js";
	import { filtersLine } from "./filters-line.svelte";
	import { webHref } from "./notice-links";

	/** The server's notes the use legend shows, in order. */
	const NOTE_KEYS = ["shades_valley", "pur_lag"] as const;

	// The foot of pesticide use's legend section: the active filters (named as charts' legends
	// name them), then the server's notes on the shades and on when use is released (each title
	// linking to its source). A period the server doesn't list is the layer's status row ("No
	// pesticide use reported for ‹period› yet", the use block's), which map-sdk draws with this
	// note under it.
	let {
		filters
	}: {
		/** The use layer's saved filters. */
		filters: PesticideFilters | undefined;
	} = $props();

	let notes = $state.raw<PesticideNote[] | null>(lastNotes);
	$effect(() => {
		const controller = new AbortController();
		pesticideMeta(controller.signal).then(
			(meta) => {
				const found = NOTE_KEYS.flatMap((key) => (meta.notes[key] ? [meta.notes[key]] : []));
				lastNotes = found;
				notes = found;
			},
			// Without the meta the note leaves out the server's notes.
			() => {}
		);
		return () => controller.abort();
	});

	// The filters' names; the last ones shown stay until the new ones are ready (no flicker).
	const named = filtersLine(() => filters);
</script>

<div class="flex flex-col gap-1" data-use-legend-note>
	{#if named.current}
		<p>{m.map_use_legend_filters({ filters: named.current })}</p>
	{/if}
	{#each notes ?? [] as note (note.key)}
		{@const href = webHref(note.source_url)}
		<div class="flex flex-col gap-0.5" data-use-note={note.key}>
			{#if href}
				<a
					{href}
					target="_blank"
					rel="noopener noreferrer"
					class="text-link font-medium underline underline-offset-4"
				>
					{note.title}
					<ExternalLinkCue class="inline size-3 align-baseline" />
				</a>
			{:else}
				<p class="font-medium">{note.title}</p>
			{/if}
			<p class="text-muted-foreground">{note.summary}</p>
		</div>
	{/each}
</div>
