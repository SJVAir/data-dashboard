<script lang="ts">
	import { getContext } from "svelte";
	import ArrowDown from "@lucide/svelte/icons/arrow-down";
	import ArrowUp from "@lucide/svelte/icons/arrow-up";
	import Minus from "@lucide/svelte/icons/minus";
	import Toggletip from "$lib/components/Toggletip.svelte";
	import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
	import { getMetadata } from "$lib/data";
	import type { CatalogEntry } from "$lib/data/metadata";
	import { STALE_MS, type CurrentReading, type Trend } from "$lib/data/now/current";
	import type { QueryState } from "$lib/data/types";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatValue } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { thresholdMarks } from "$lib/thresholds/marks.svelte";
	import { CurrentConditions } from "../shared/current.svelte";
	import { entryMeta, mainLayer } from "../shared/input";
	import LevelChip from "../shared/LevelChip.svelte";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "../shared/viewer";
	import WidgetState from "../shared/WidgetState.svelte";
	import { placeLabel } from "../title";
	import { setGeneratedTitle } from "../titles.svelte";

	let { widget }: { widget: WidgetInstance } = $props();

	const viewer = getContext<PlaceViewer | undefined>(PLACE_VIEWER_KEY) ?? "owner";
	const current = new CurrentConditions(() => widget);

	let catalog = $state.raw<CatalogEntry[] | undefined>();
	void getMetadata()
		.catalog()
		.then((c) => {
			if (c !== "unavailable") catalog = c;
		});
	const meta = $derived(entryMeta(catalog, mainLayer(widget.data, catalog)));

	// "Updated N min ago" and staleness change between polls, so time ticks once a minute.
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(timer);
	});

	const reading = $derived(current.reading);
	// A new reading (each poll) is also a fresh look at the clock.
	$effect(() => {
		void reading;
		now = Date.now();
	});
	const ok = $derived(reading?.status === "ok" ? reading : undefined);
	/** An hour that ended too long ago, since the last poll, is "No recent data". */
	const stale = $derived(!!ok && now - ok.at > STALE_MS);
	const minutes = $derived(ok ? Math.max(0, Math.floor((now - ok.at) / 60_000)) : 0);
	const mark = $derived(thresholdMarks[widget.id]);

	/** The query's state as WidgetState understands it; "ready" shows our own body. */
	const shown = $derived.by((): QueryState => {
		const s = current.state;
		if (s === "loading") return { status: "loading" };
		if (s === "error") return { status: "error", error: new Error("current") };
		if (typeof s === "object") return { status: "unavailable", reason: s.unavailable };
		return { status: "loading" };
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
		if (current.state !== "ready" || !place || !meta) return;
		setGeneratedTitle(
			widget.id,
			m.label_join({ first: meta.entryType.label, second: placeLabel(place, viewer) })
		);
	});

	function averageLabel(r: Extract<CurrentReading, { status: "ok" }>): string {
		if (r.source === "alert") return m.current_minute_average({ minutes: r.windowMinutes ?? 0 });
		if (r.source === "alert-latest") return m.current_latest_reading();
		return m.current_hourly_average();
	}

	function trendText(t: Trend): string {
		if (t === "rising") return m.current_trend_rising();
		if (t === "falling") return m.current_trend_falling();
		return m.current_trend_steady();
	}

	function emptyText(r: CurrentReading | undefined): string {
		switch (r?.status) {
			case "pending":
				return m.current_not_available_yet();
			case "insufficient":
				return m.current_not_enough_readings();
			case "no-recent":
				return m.current_no_recent_data();
			default:
				return m.current_no_data();
		}
	}
</script>

<!-- WidgetState's data body: unused, since a ready reading renders above. -->
{#snippet noBody()}{/snippet}

{#snippet message(text: string)}
	<p class="text-muted-foreground flex h-full items-center justify-center text-center text-sm">
		{text}
	</p>
{/snippet}

<div
	class="relative flex h-full flex-col justify-center gap-2 rounded-(--radius-control)"
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
	{#if current.state === "ready"}
		{#if ok && !stale && meta}
			<div class="flex flex-wrap items-baseline gap-x-2 px-2">
				<span class="text-3xl leading-none font-semibold tabular-nums">
					{formatValue(ok.value, meta.entryType.precision)}
				</span>
				<span class="text-muted-foreground text-sm">{meta.entryType.units}</span>
			</div>
			<div class="flex flex-wrap items-center gap-2 px-2">
				{#if ok.level}<LevelChip level={ok.level} />{/if}
				{#if ok.trend}
					<span class="text-muted-foreground inline-flex items-center gap-1 text-sm">
						{#if ok.trend === "rising"}
							<ArrowUp class="size-4" aria-hidden="true" />
						{:else if ok.trend === "falling"}
							<ArrowDown class="size-4" aria-hidden="true" />
						{:else}
							<Minus class="size-4" aria-hidden="true" />
						{/if}
						{trendText(ok.trend)}
					</span>
				{/if}
			</div>
			{#if ok.level?.guidance}
				<p data-guidance class="px-2 text-sm">{ok.level.guidance}</p>
			{/if}
			{#if mark}
				<p class="bg-muted mx-2 rounded-(--radius-control) px-2 py-1 text-sm font-medium">
					{m.current_at_alert_level()}
				</p>
			{/if}
			<p class="text-muted-foreground flex items-center gap-1 px-2 text-xs">
				<span>
					{m.current_source_updated({
						average: averageLabel(ok),
						minutes: String(minutes)
					})}
				</span>
				<Toggletip label={m.current_averaging_label()} text={m.current_averaging_help()} />
			</p>
		{:else}
			{@render message(stale ? m.current_no_recent_data() : emptyText(reading))}
		{/if}
	{:else}
		<WidgetState
			state={shown}
			{widget}
			{retired}
			onretry={current.retry}
			onchoose={() => openPlacePicker({ widgetId: widget.id })}
			children={noBody}
		/>
	{/if}
</div>
