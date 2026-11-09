<script lang="ts">
	import { getContext } from "svelte";
	import ArrowDown from "@lucide/svelte/icons/arrow-down";
	import ArrowUp from "@lucide/svelte/icons/arrow-up";
	import Minus from "@lucide/svelte/icons/minus";
	import Toggletip from "$lib/components/Toggletip.svelte";
	import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
	import type { Trend } from "$lib/data/now/current";
	import type { QueryState } from "$lib/data/types";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatValue } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { CurrentConditions } from "../shared/current.svelte";
	import LevelChip from "../shared/LevelChip.svelte";
	import MarkFrame from "../shared/MarkFrame.svelte";
	import { ReadingClock } from "../shared/reading-clock.svelte";
	import { averageLabel, emptyText, updatedText } from "../shared/reading-text";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "../shared/viewer";
	import WidgetState from "../shared/WidgetState.svelte";
	import { placeLabel } from "../title";
	import { setGeneratedTitle } from "../titles.svelte";

	let { widget }: { widget: WidgetInstance } = $props();

	const viewer = getContext<PlaceViewer | undefined>(PLACE_VIEWER_KEY) ?? "owner";
	const current = new CurrentConditions(() => widget);

	const meta = $derived(current.meta);

	const reading = $derived(current.reading);
	const clock = new ReadingClock(() => reading);
	const ok = $derived(clock.ok);
	const stale = $derived(clock.stale);
	const minutes = $derived(clock.minutes);

	/** Held as loading until the catalog has the entry type (units, precision, label). */
	const shown = $derived<QueryState>(
		current.shown.status === "ready" && !meta ? { status: "loading" } : current.shown
	);
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

	function trendText(t: Trend): string {
		if (t === "rising") return m.current_trend_rising();
		if (t === "falling") return m.current_trend_falling();
		return m.current_trend_steady();
	}
</script>

{#snippet message(text: string)}
	<p class="text-muted-foreground flex h-full items-center justify-center text-center text-sm">
		{text}
	</p>
{/snippet}

{#snippet body()}
	{#if ok && !stale && meta}
		<div class="flex h-full flex-col justify-center gap-2">
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
			<p class="text-muted-foreground flex items-center gap-1 px-2 text-xs">
				<span>
					{updatedText(averageLabel(ok), minutes)}
				</span>
				<Toggletip
					label={ok.source === "alert-latest"
						? m.current_about_this_reading()
						: m.current_about_this_average()}
					text={ok.source === "alert-latest"
						? m.current_latest_reading_help()
						: m.current_average_help()}
				/>
			</p>
		</div>
	{:else}
		{@render message(stale ? m.current_no_recent_data() : emptyText(reading, m.current_no_data()))}
	{/if}
{/snippet}

<MarkFrame widgetId={widget.id}>
	<WidgetState
		state={shown}
		{widget}
		{retired}
		onretry={current.retry}
		onchoose={() => openPlacePicker({ widgetId: widget.id })}
		emptyText={m.current_no_data()}
		children={body}
	/>
</MarkFrame>
