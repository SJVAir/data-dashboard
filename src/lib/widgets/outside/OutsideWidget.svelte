<script lang="ts">
	import { getContext, onDestroy, untrack } from "svelte";
	import ExternalLinkCue from "$lib/components/shared/ExternalLinkCue.svelte";
	import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
	import { getMetadata, getResolvers } from "$lib/data";
	import type { SchoolGuidelines } from "@sjvair/sdk";
	import type { NowState } from "$lib/data/now/client";
	import { getNowClient } from "$lib/data/now";
	import { heatSource, type HeatToday } from "$lib/data/now/heat";
	import { NowQuery } from "$lib/data/now/now-query.svelte";
	import type { Layer } from "$lib/data/schema";
	import type { QueryState } from "$lib/data/types";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { m } from "$lib/paraglide/messages.js";
	import { CurrentConditions } from "../shared/current.svelte";
	import LevelChip from "../shared/LevelChip.svelte";
	import MarkFrame from "../shared/MarkFrame.svelte";
	import { ReadingClock } from "../shared/reading-clock.svelte";
	import { averageLabel, emptyText } from "../shared/reading-text";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "../shared/viewer";
	import WidgetState from "../shared/WidgetState.svelte";
	import { placeLabel } from "../title";
	import { setGeneratedTitle } from "../titles.svelte";
	import ActivityRow from "./ActivityRow.svelte";
	import { asPm25 } from "./pm25";

	let { widget }: { widget: WidgetInstance } = $props();

	const viewer = getContext<PlaceViewer | undefined>(PLACE_VIEWER_KEY) ?? "owner";

	// The card is always about PM2.5 (the only pollutant with school guidelines), whatever the
	// saved layer says.
	const pm25Widget = $derived(asPm25(widget));
	const current = new CurrentConditions(() => pm25Widget);
	const meta = $derived(current.meta);

	// --- School guidelines ---
	let guidelines = $state.raw<SchoolGuidelines | null | undefined>();
	let guidelinesError = $state.raw<unknown>(null);
	let guidelinesTry = $state(0);
	$effect(() => {
		void guidelinesTry;
		const abort = new AbortController();
		guidelines = undefined;
		guidelinesError = null;
		getMetadata()
			.schoolGuidelines("pm25", abort.signal)
			.then(
				(g) => (guidelines = g),
				(error: unknown) => {
					if (!abort.signal.aborted) guidelinesError = error;
				}
			);
		return () => abort.abort();
	});

	// --- Today's heat ---
	const layer = $derived<Layer | undefined>(
		pm25Widget.data.layers.find((l) => l.dataset === "air-quality" && (l.place || l.selection))
	);
	// Equal layers (a re-render of the same widget) don't resolve the source again.
	const layerKey = $derived(layer ? JSON.stringify(layer) : "");

	const heatQuery = new NowQuery<HeatToday>(getNowClient());
	onDestroy(() => heatQuery.destroy());
	$effect(() => heatQuery.setPolling(!widget.minimized));

	let heatFailed = $state(false);
	$effect(() => {
		void layerKey;
		const target = untrack(() => layer);
		heatFailed = false;
		if (!target) {
			heatQuery.set(null);
			return;
		}
		let cancelled = false;
		const abort = new AbortController();
		heatSource(
			target,
			{ metadata: getMetadata(), ...getResolvers() },
			() => new Date(),
			abort.signal
		).then(
			(source) => {
				if (cancelled) return;
				if ("unavailable" in source) {
					heatFailed = true;
					heatQuery.set(null);
				} else {
					heatQuery.set(source);
				}
			},
			() => {
				// A heat source that can't be resolved must not fail the card.
				if (cancelled) return;
				heatFailed = true;
				heatQuery.set(null);
			}
		);
		return () => {
			cancelled = true;
			abort.abort();
		};
	});

	const heatState = $derived<NowState<HeatToday>>(heatQuery.state);
	/** `undefined` while loading; `null` when there is no score today or the source failed. */
	const heat = $derived.by<HeatToday | undefined>(() => {
		if (heatFailed) return null;
		if (heatState.data !== undefined) return heatState.data;
		return heatState.status === "error" ? null : undefined;
	});

	// --- Reading ---
	const reading = $derived(current.reading);
	const clock = new ReadingClock(() => reading);
	const ok = $derived(clock.ok);
	const stale = $derived(clock.stale);
	const minutes = $derived(clock.minutes);

	/** Held as loading until the catalog and the guidelines are in. */
	const shown = $derived.by<QueryState>(() => {
		const s = current.shown;
		if (s.status !== "ready") return s;
		if (guidelinesError) return { status: "error", error: guidelinesError, data: s.data };
		if (!meta || guidelines === undefined) return { status: "loading" };
		return s;
	});
	const retired = $derived.by(() => {
		if (!meta) return undefined;
		const r = meta.entryType.retired ?? meta.dataset.retired;
		if (!r) return undefined;
		return {
			name: meta.entryType.retired ? meta.entryType.label : meta.dataset.label,
			since: r.since
		};
	});

	$effect(() => {
		const place = reading?.place;
		if (current.state !== "ready" || !place) return;
		setGeneratedTitle(
			widget.id,
			m.label_join({ first: m.widget_outside_title(), second: placeLabel(place, viewer) })
		);
	});

	function retry(): void {
		if (guidelinesError) guidelinesTry++;
		current.retry();
	}

	/** The guideline sentences for an activity at the current level; never another level's. */
	function sentencesFor(levels: Record<string, string[]>, key: string | undefined): string[] {
		return (key !== undefined ? levels[key] : undefined) ?? [];
	}
</script>

{#snippet body()}
	<div class="flex h-full flex-col gap-2">
		<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
			{#if ok && !stale}
				<div class="flex flex-wrap items-center gap-x-2 gap-y-1 px-2">
					{#if ok.level}<LevelChip level={ok.level} />{/if}
					<span class="text-muted-foreground text-xs">
						{m.current_source_updated({
							average: averageLabel(ok),
							minutes: String(minutes)
						})}
					</span>
				</div>
				{#if !guidelines}
					<p class="text-muted-foreground px-2 text-sm">{m.outside_no_guidance()}</p>
				{:else}
					<ul>
						{#each guidelines.activities as activity (activity.key)}
							<ActivityRow
								label={activity.label}
								duration={activity.duration}
								sentences={sentencesFor(activity.levels, ok.level?.key)}
							/>
						{/each}
					</ul>
				{/if}
			{:else}
				<p
					class="text-muted-foreground flex flex-1 items-center justify-center px-2 text-center text-sm"
				>
					{stale ? m.current_no_recent_data() : emptyText(reading, m.outside_no_pm25())}
				</p>
			{/if}
		</div>
		<div data-heat class="border-border shrink-0 border-t px-2 pt-2">
			{#if heat !== undefined}
				<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
					<span class="text-sm font-semibold">{m.outside_heat_today()}</span>
					{#if heat?.level}
						<LevelChip level={heat.level} />
					{:else}
						<span class="text-muted-foreground text-sm">{m.outside_heat_unavailable()}</span>
					{/if}
				</div>
				{#if heat?.level}
					{#if heat.highest}
						<p class="text-muted-foreground text-xs">
							{m.outside_heat_highest({ place: heat.highest.placeName, zip: heat.highest.zip })}
						</p>
					{/if}
					{#if heat.level.guidance}
						<p data-heat-guidance class="text-sm">{heat.level.guidance}</p>
					{/if}
				{/if}
			{/if}
			{#if guidelines?.source}
				<p class="text-muted-foreground mt-1 text-xs">
					{#if guidelines.source.url}
						<a href={guidelines.source.url} class="underline" target="_blank" rel="noreferrer">
							{m.outside_source({ name: guidelines.source.name })}
							<ExternalLinkCue class="inline size-3.5 align-baseline" />
						</a>
					{:else}
						{m.outside_source({ name: guidelines.source.name })}
					{/if}
				</p>
			{/if}
		</div>
	</div>
{/snippet}

<MarkFrame widgetId={widget.id}>
	<WidgetState
		state={shown}
		{widget}
		{retired}
		onretry={retry}
		onchoose={() => openPlacePicker({ widgetId: widget.id })}
		ownsEmpty
		children={body}
	/>
</MarkFrame>
