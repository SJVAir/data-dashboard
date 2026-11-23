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
	import type { QueryLayer, QueryState } from "$lib/data/types";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { m } from "$lib/paraglide/messages.js";
	import { markKey } from "$lib/thresholds/marks.svelte";
	import { CurrentConditions } from "../shared/current.svelte";
	import { hasPlaces, queryLayer } from "../shared/input";
	import LevelChip from "../shared/LevelChip.svelte";
	import MarkFrame from "../shared/MarkFrame.svelte";
	import { ReadingClock } from "../shared/reading-clock.svelte";
	import { averageLabel, emptyText, updatedText } from "../shared/reading-text";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "../shared/viewer";
	import WidgetState from "../shared/WidgetState.svelte";
	import { placeLabel } from "../title";
	import { setGeneratedTitle } from "../titles.svelte";
	import ActivityRow from "./ActivityRow.svelte";

	let { widget }: { widget: WidgetInstance } = $props();

	const viewer = getContext<PlaceViewer | undefined>(PLACE_VIEWER_KEY) ?? "owner";

	const current = new CurrentConditions(() => widget);
	const meta = $derived(current.meta);

	// --- School guidelines ---
	let guidelines = $state.raw<SchoolGuidelines | null | undefined>();
	let guidelinesError = $state.raw<unknown>(null);
	let guidelinesTry = $state(0);
	/** The pollutant the card is about: its air-quality layer's. */
	const entryType = $derived(
		widget.data.layers.find((l) => l.dataset === "air-quality")?.entryType
	);
	$effect(() => {
		void guidelinesTry;
		const pollutant = entryType;
		if (!pollutant) {
			guidelines = null;
			guidelinesError = null;
			return;
		}
		const abort = new AbortController();
		guidelines = undefined;
		guidelinesError = null;
		getMetadata()
			.schoolGuidelines(pollutant, abort.signal)
			.then(
				(g) => (guidelines = g),
				(error: unknown) => {
					if (!abort.signal.aborted) guidelinesError = error;
				}
			);
		return () => abort.abort();
	});

	// --- Today's heat ---
	const layer = $derived.by<QueryLayer | undefined>(() => {
		const found = widget.data.layers.find((l) => l.dataset === "air-quality");
		return found && hasPlaces(widget.data) ? queryLayer(widget.data, found) : undefined;
	});
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
	const heatLoadFailed = $derived(
		heatFailed || (heatState.data === undefined && heatState.status === "error")
	);
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
						{updatedText(averageLabel(ok), minutes)}
					</span>
				</div>
				{#if !guidelines}
					<p class="text-muted-foreground px-2 text-sm">{m.outside_no_activity_guidance()}</p>
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
					{stale
						? m.current_no_recent_data()
						: emptyText(
								reading,
								meta
									? m.outside_no_pollutant_data({ pollutant: meta.entryType.label })
									: m.current_no_data()
							)}
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
						<span class="text-muted-foreground text-sm"
							>{heatLoadFailed ? m.outside_heat_load_failed() : m.outside_no_heat_score_today()}
						</span>
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
							{m.source_named({ name: guidelines.source.name })}
							<ExternalLinkCue class="inline size-3.5 align-baseline" />
						</a>
					{:else}
						{m.source_named({ name: guidelines.source.name })}
					{/if}
				</p>
			{/if}
		</div>
	</div>
{/snippet}

{#if !entryType}
	<p class="text-muted-foreground flex h-full items-center justify-center px-2 text-center text-sm">
		{m.outside_no_guideline_pollutants()}
	</p>
{:else}
	<MarkFrame
		{widget}
		markKey={markKey(widget.id)}
		{reading}
		levels={current.levels}
		now={clock.now}
	>
		<WidgetState
			state={shown}
			{widget}
			{retired}
			pollutant={meta?.entryType.label}
			onretry={retry}
			onchoose={() => openPlacePicker({ widgetId: widget.id })}
			idleText={m.widget_state_idle_place_or_monitor()}
			ownsEmpty
			children={body}
		/>
	</MarkFrame>
{/if}
