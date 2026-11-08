<script lang="ts">
	import { getContext, onDestroy, untrack } from "svelte";
	import ExternalLinkCue from "$lib/components/shared/ExternalLinkCue.svelte";
	import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
	import { getMetadata, getResolvers } from "$lib/data";
	import type { SchoolGuidelines } from "@sjvair/sdk";
	import type { NowState } from "$lib/data/now/client";
	import { getNowClient } from "$lib/data/now";
	import { STALE_MS, type CurrentReading } from "$lib/data/now/current";
	import { heatSource, type HeatToday } from "$lib/data/now/heat";
	import { NowQuery } from "$lib/data/now/now-query.svelte";
	import type { Layer } from "$lib/data/schema";
	import type { QueryState } from "$lib/data/types";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { m } from "$lib/paraglide/messages.js";
	import { thresholdMarks } from "$lib/thresholds/marks.svelte";
	import { CurrentConditions } from "../shared/current.svelte";
	import LevelChip from "../shared/LevelChip.svelte";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "../shared/viewer";
	import WidgetState from "../shared/WidgetState.svelte";
	import { placeLabel } from "../title";
	import { setGeneratedTitle } from "../titles.svelte";
	import ActivityRow from "./ActivityRow.svelte";

	let { widget }: { widget: WidgetInstance } = $props();

	const viewer = getContext<PlaceViewer | undefined>(PLACE_VIEWER_KEY) ?? "owner";

	// The card is always about PM2.5 (the only pollutant with school guidelines), whatever the
	// saved layer says.
	const pm25Widget = $derived<WidgetInstance>({
		...widget,
		data: {
			...widget.data,
			layers: widget.data.layers.map((l) =>
				l.dataset === "air-quality" && l.entryType && l.entryType !== "pm25"
					? { ...l, entryType: "pm25" }
					: l
			)
		}
	});
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

	// --- Clock ---
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(timer);
	});

	const reading = $derived(current.reading);
	$effect(() => {
		void reading;
		now = Date.now();
	});
	const ok = $derived(reading?.status === "ok" ? reading : undefined);
	const stale = $derived(!!ok && now - ok.at > STALE_MS);
	const minutes = $derived(ok ? Math.max(0, Math.floor((now - ok.at) / 60_000)) : 0);
	const mark = $derived(thresholdMarks[widget.id]);

	/** Held as loading until the catalog and the guidelines are in. */
	const shown = $derived.by<QueryState>(() => {
		const s = current.shown;
		if (s.status !== "ready") return s;
		if (guidelinesError) return { status: "error", error: guidelinesError, data: s.data };
		if (!meta || guidelines === undefined) return { status: "loading" };
		// An empty range would replace the whole card; this one keeps its heat line and says
		// "no PM2.5" itself, so give the shared state one point to render.
		if (s.data.series.every((x) => !x.points.length)) {
			return {
				status: "ready",
				data: {
					...s.data,
					series: [
						{
							place: s.data.places[0]?.place ?? "",
							points: [{ t: 0, mean: 0, min: 0, max: 0, count: 1, partial: false }]
						}
					]
				}
			};
		}
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

	function averageLabel(r: Extract<CurrentReading, { status: "ok" }>): string {
		if (r.source === "alert") return m.current_minute_average({ minutes: r.windowMinutes ?? 0 });
		if (r.source === "alert-latest") return m.current_latest_reading();
		return m.current_hourly_average();
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
				{#if guidelines}
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
					{m.outside_no_pm25()}
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

<div
	class="relative flex h-full flex-col gap-2 rounded-(--radius-control)"
	data-mark={mark ? "" : undefined}
	style:outline-style={mark ? "solid" : undefined}
	style:outline-width={mark ? "3px" : undefined}
	style:outline-offset={mark ? "-3px" : undefined}
	style:outline-color={mark?.level.color ?? (mark ? "var(--foreground)" : undefined)}
>
	{#if mark}
		{#key mark.pulse}
			<span
				data-pulse={mark.pulse}
				aria-hidden="true"
				class="pointer-events-none absolute inset-0 rounded-(--radius-control)"
				style:outline="3px solid {mark.level.color ?? 'var(--foreground)'}"
			></span>
		{/key}
	{/if}
	<div class="min-h-0 flex-1">
		<WidgetState
			state={shown}
			{widget}
			{retired}
			onretry={retry}
			onchoose={() => openPlacePicker({ widgetId: widget.id })}
			emptyText={m.outside_no_pm25()}
			children={body}
		/>
	</div>
	{#if mark}
		<p class="bg-muted mx-2 mb-2 rounded-(--radius-control) px-2 py-1 text-sm font-medium">
			{m.current_at_alert_level()}
		</p>
	{/if}
</div>
