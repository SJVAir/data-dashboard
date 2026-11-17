<script lang="ts" module>
	import type { PesticideNote } from "@sjvair/sdk";

	/**
	 * The last ready lines, kept across a remount (a new plugin after a zoom, figure or period
	 * change draws the note again): the server's notes, and the filters' names by filters key.
	 */
	let lastNotes: PesticideNote[] | null = null;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a cache read at mount, not state
	const lastNamed = new Map<string, string | null>();

	/** Forgets the kept lines (for tests). */
	export function resetUseLegendNote(): void {
		lastNotes = null;
		lastNamed.clear();
	}
</script>

<script lang="ts">
	import { untrack } from "svelte";
	import ExternalLinkCue from "$lib/components/shared/ExternalLinkCue.svelte";
	import { filterSummary, pesticideMeta } from "$lib/data/pesticide-meta";
	import type { PesticideFilters } from "$lib/data/schema";
	import { m } from "$lib/paraglide/messages.js";
	import { filtersKey as keyOf } from "./data/filters-key";
	import { webHref } from "./notice-links";
	import { periodLabel, type UsePeriod } from "./use-period";

	/** The server's notes the use legend shows, in order. */
	const NOTE_KEYS = ["shades_valley", "pur_lag"] as const;

	// The foot of pesticide use's legend section: "No data for ‹period›" for a period the server
	// doesn't list, the active filters (named as charts' legends name them), then the server's
	// notes on the shades and on when use is released (each title linking to its source).
	let {
		period,
		unlisted,
		filters
	}: {
		/** The period drawn. */
		period: UsePeriod | null;
		/** The server doesn't list the period's year: nothing is drawn. */
		unlisted: boolean;
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

	/** The filters as a key, so an equal set saved again asks for nothing. */
	const filtersKey = $derived(keyOf(filters ?? {}));
	// The last names shown stay until the new ones are ready (no flicker).
	let named = $state.raw<string | null>(untrack(() => lastNamed.get(filtersKey) ?? null));
	$effect(() => {
		const key = filtersKey;
		const saved = JSON.parse(key) as PesticideFilters;
		if (lastNamed.has(key)) named = lastNamed.get(key) ?? null;
		const controller = new AbortController();
		filterSummary(saved, controller.signal).then(
			(labels) => {
				const joined =
					labels.length === 0
						? null
						: labels.reduce((all, label) => m.label_join({ first: all, second: label }));
				lastNamed.set(key, joined);
				named = joined;
			},
			// A gone filter is the map's own note; any other failure leaves the line out.
			() => {
				if (!controller.signal.aborted) named = null;
			}
		);
		return () => controller.abort();
	});
</script>

<div class="flex flex-col gap-1" data-use-legend-note>
	{#if unlisted && period}
		<p class="text-foreground font-medium">
			{m.map_use_no_data({ period: periodLabel(period) })}
		</p>
	{/if}
	{#if named}
		<p>{m.map_use_legend_filters({ filters: named })}</p>
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
