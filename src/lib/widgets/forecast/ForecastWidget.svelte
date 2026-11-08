<script lang="ts">
	import { getContext, onDestroy, untrack } from "svelte";
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
	import ExternalLinkCue from "$lib/components/shared/ExternalLinkCue.svelte";
	import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
	import { getMetadata, getResolvers } from "$lib/data";
	import type { NowState } from "$lib/data/now/client";
	import {
		forecastDaysSource,
		type ForecastDay,
		type ForecastDays
	} from "$lib/data/now/forecast-days";
	import { getNowClient } from "$lib/data/now";
	import { NowQuery } from "$lib/data/now/now-query.svelte";
	import type { Layer } from "$lib/data/schema";
	import type { QueryState, UnavailableReason } from "$lib/data/types";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatWeekdayDate, formatWeekdayTime, todayPacific } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import LevelChip from "../shared/LevelChip.svelte";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "../shared/viewer";
	import WidgetState from "../shared/WidgetState.svelte";
	import { placeLabel } from "../title";
	import { setGeneratedTitle } from "../titles.svelte";

	let { widget }: { widget: WidgetInstance } = $props();

	const viewer = getContext<PlaceViewer | undefined>(PLACE_VIEWER_KEY) ?? "owner";

	const layer = $derived<Layer | undefined>(
		widget.data.layers.find((l) => l.dataset === "forecasts" && (l.place || l.selection))
	);
	// Equal layers (a re-render of the same widget) don't resolve the source again.
	const layerKey = $derived(layer ? JSON.stringify(layer) : "");

	const query = new NowQuery<ForecastDays>(getNowClient());
	onDestroy(() => query.destroy());
	$effect(() => query.setPolling(!widget.minimized));

	let unavailable = $state<UnavailableReason | null>(null);
	$effect(() => {
		void layerKey;
		const current = untrack(() => layer);
		if (!current) {
			unavailable = null;
			query.set(null);
			return;
		}
		let cancelled = false;
		const abort = new AbortController();
		const resolve = (signal?: AbortSignal) =>
			forecastDaysSource(
				current,
				{ metadata: getMetadata(), ...getResolvers() },
				() => new Date(),
				signal
			);
		resolve(abort.signal).then(
			(source) => {
				if (cancelled) return;
				if ("unavailable" in source) {
					unavailable = source.unavailable;
					query.set(null);
				} else {
					unavailable = null;
					query.set(source);
				}
			},
			(error: unknown) => {
				if (cancelled) return;
				unavailable = null;
				// The target couldn't be resolved: keyed by widget (never by the place's
				// coordinates), and Retry resolves it again before fetching.
				let failedOnce = false;
				query.set({
					key: `forecast-days:unresolved:${widget.id}`,
					cadence: "hour",
					fetch: async (signal) => {
						// The first fetch reports the failure that got us here; later ones try again.
						if (!failedOnce) {
							failedOnce = true;
							throw error;
						}
						const source = await resolve(signal);
						if ("unavailable" in source) {
							unavailable = source.unavailable;
							throw error;
						}
						return source.fetch(signal);
					}
				});
			}
		);
		return () => {
			cancelled = true;
			abort.abort();
		};
	});

	// "Today" and "Tomorrow" turn over at Pacific midnight, so time ticks once a minute.
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(timer);
	});
	const today = $derived(todayPacific(new Date(now)));

	const nowState = $derived<NowState<ForecastDays>>(query.state);
	const days = $derived(nowState.data);

	/** The widget state's shape, so the shared states, notes and retries apply as they do elsewhere. */
	const shown = $derived.by<QueryState>(() => {
		if (unavailable) return { status: "unavailable", reason: unavailable };
		const d = nowState.data;
		const data = d && {
			// No series: the body says "no forecast" itself (WidgetState `ownsEmpty`).
			series: [],
			places: d.place ? [d.place] : [],
			resolution: "day" as const,
			fromRaw: false,
			processor: null,
			fetchedAt: 0
		};
		switch (nowState.status) {
			case "idle":
				return { status: "idle" };
			case "loading":
				return { status: "loading", ...(data && { data }) };
			case "error":
				return { status: "error", error: nowState.error, ...(data && { data }) };
			default:
				return { status: "ready", data: data! };
		}
	});

	$effect(() => {
		const place = days?.place;
		if (nowState.status !== "ready" || !place) return;
		setGeneratedTitle(
			widget.id,
			m.label_join({ first: m.widget_forecast_title(), second: placeLabel(place, viewer) })
		);
	});

	/** An Air Alert bound: a date or a timestamp, shown in Pacific time. */
	function alertTime(value: string): string {
		return formatWeekdayDate(
			/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayPacific(new Date(value))
		);
	}

	function dayName(day: ForecastDay): string {
		return day.date === today ? m.forecast_today() : m.forecast_tomorrow();
	}

	/** The sources shown once each (both scales may share one). */
	const sourceLinks = $derived(
		[days?.sources.aqi, days?.sources.burn].filter(
			(s, i, all): s is { name: string; url: string } =>
				!!s && all.findIndex((o) => o?.name === s.name) === i
		)
	);
</script>

{#snippet message(text: string)}
	<p class="text-muted-foreground flex h-full items-center justify-center text-center text-sm">
		{text}
	</p>
{/snippet}

{#snippet body()}
	{#if days}
		{@const shownDays = days.days.filter((d) => d.date >= today)}
		<div class="flex h-full flex-col gap-2">
			{#if days.airAlert}
				<p
					data-air-alert
					class="bg-muted flex items-center gap-2 rounded-(--radius-control) px-2 py-1 text-sm font-medium"
				>
					<TriangleAlert class="size-4 shrink-0" aria-hidden="true" />
					<span>
						{m.forecast_air_alert({
							start: alertTime(days.airAlert.start),
							end: alertTime(days.airAlert.end)
						})}
					</span>
				</p>
			{/if}
			{#if shownDays.length === 0}
				{@render message(days.zone ? m.forecast_none_yet() : m.forecast_none_here())}
			{:else}
				<ul class="flex min-h-0 flex-1 flex-col justify-center gap-3">
					{#each shownDays as day (day.date)}
						<li
							data-forecast-day={day.date}
							class="flex flex-wrap items-start gap-x-3 gap-y-1 px-2"
						>
							<div class="min-w-20">
								<p class="text-sm font-semibold">{dayName(day)}</p>
								<p class="text-muted-foreground text-xs">{formatWeekdayDate(day.date)}</p>
							</div>
							<div class="flex min-w-0 flex-1 flex-col items-start gap-1">
								<div class="flex flex-wrap items-center gap-2">
									{#if day.aqiLevel}<LevelChip level={day.aqiLevel} />{/if}
									<span class="text-sm tabular-nums">
										{m.forecast_aqi({ value: String(day.aqi), pollutant: day.pollutant })}
									</span>
								</div>
								{#if day.burn}
									{#if "level" in day.burn}
										<LevelChip level={day.burn.level} size="sm" />
									{:else}
										<span
											class="bg-muted text-foreground inline-flex items-center rounded-(--radius-control) px-1.5 py-0.5 text-xs font-medium"
										>
											{day.burn.text}
										</span>
									{/if}
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
			{#if days.zone}
				<p class="text-muted-foreground px-2 text-xs">
					{days.zone.nearest
						? m.forecast_zone_nearest({ zone: days.zone.name })
						: m.forecast_zone({ zone: days.zone.name })}
				</p>
			{/if}
			{#if days.publishedAt || sourceLinks.length}
				<p class="text-muted-foreground flex flex-wrap gap-x-2 px-2 text-xs">
					{#if days.publishedAt}
						<span>
							{m.forecast_issued({ time: formatWeekdayTime(new Date(days.publishedAt)) })}
						</span>
					{/if}
					{#each sourceLinks as s (s.name)}
						{#if s.url}
							<a href={s.url} class="underline" target="_blank" rel="noreferrer">
								{m.forecast_source({ name: s.name })}
								<ExternalLinkCue class="inline size-3.5 align-baseline" />
							</a>
						{:else}
							<span>{m.forecast_source({ name: s.name })}</span>
						{/if}
					{/each}
				</p>
			{/if}
		</div>
	{/if}
{/snippet}

<div class="h-full rounded-(--radius-control)">
	<WidgetState
		state={shown}
		{widget}
		onretry={() => query.retry()}
		onchoose={() => openPlacePicker({ widgetId: widget.id })}
		ownsEmpty
		children={body}
	/>
</div>
