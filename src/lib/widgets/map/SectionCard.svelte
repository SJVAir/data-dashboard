<script lang="ts">
	import type { Scale } from "@sjvair/map-sdk/data";
	import type { PesticideSectionDetail, PesticidesMeta } from "@sjvair/sdk";
	import { pesticideMeta } from "$lib/data/pesticide-meta";
	import { formatMonthName, formatValue } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import ExternalLinkCue from "$lib/components/shared/ExternalLinkCue.svelte";
	import type { PesticideFilters } from "$lib/data/schema";
	import { filtersKey } from "./data/filters-key";
	import { sectionDetail } from "./data/section-detail";
	import { useField, type UseProps } from "./data/use";
	import {
		peakMonth,
		topChemicals,
		townshipLineParts,
		type UseFigure,
		type UseTownshipLine
	} from "./use-card";
	import UseCardFigures from "./UseCardFigures.svelte";
	import { chemicalLink, sectionLinks, type NoticesDay } from "./section-links";
	import type { UsePeriod } from "./use-period";

	// A section's card: its MTRS code and county, the active filters, and its three figures (the
	// shown one with its class in words), from the map feature itself. Pinned or focused, it also
	// loads the section's year: the shown figure by month as small bars (with a text list), the
	// peak month, and its top chemicals with their badges (all following the Map's filters and
	// month), and links out to the explorer from the meta's templates. Its line "In township ‹id› ·
	// ‹figure›" sits under the figures in both forms; on the interactive card the id is a button
	// that swaps the card for the township's. On hover (map-sdk's non-interactive tooltip) it
	// fetches nothing and has nothing focusable. Esc and the lens are map-sdk's.
	let {
		props,
		figure,
		figures,
		period,
		scale,
		filtersLine,
		filters,
		noticesDay,
		township,
		ontownship,
		interactive
	}: {
		props: UseProps;
		figure: string;
		figures: UseFigure[];
		period: UsePeriod;
		scale: Scale | null;
		/** The active filters' names, or null with none. */
		filtersLine: string | null;
		/** The Map's saved filters: the card's detail and links follow them. */
		filters: PesticideFilters;
		/** The day the notices layer shows when it shows a past day; null otherwise. */
		noticesDay: NoticesDay | null;
		/** The section's township, for the "In township ‹id› · ‹figure›" line; null for none. */
		township: UseTownshipLine | null;
		/** The township button: swaps the card for the township's (synchronously, for focus). */
		ontownship?: () => void;
		/** The pinned or focused card; false for the hover tooltip's static form. */
		interactive: boolean;
	} = $props();

	let detail = $state.raw<PesticideSectionDetail | null>(null);
	let failed = $state(false);
	let tries = $state(0);
	// Keyed on primitives: a map refetch makes new properties for the same section, which must
	// neither ask again nor retry a failure (only Retry does).
	const sectionId = $derived(props.id);
	const year = $derived(period.year);
	const month = $derived(period.month);
	// The filters as a key, so a map refetch that leaves them unchanged doesn't ask again.
	const filtersJson = $derived(filtersKey(filters));
	$effect(() => {
		// The hover form fetches nothing: every pointer move across sections would ask.
		if (!interactive) return;
		const id = sectionId;
		const asked = { year, month, filters: JSON.parse(filtersJson) as PesticideFilters };
		void tries;
		const controller = new AbortController();
		failed = false;
		sectionDetail(id, asked, controller.signal).then(
			(value) => (detail = value),
			() => {
				if (!controller.signal.aborted) failed = true;
			}
		);
		return () => controller.abort();
	});

	let meta = $state.raw<PesticidesMeta | null>(null);
	$effect(() => {
		if (!interactive) return;
		const controller = new AbortController();
		pesticideMeta(controller.signal).then(
			(value) => (meta = value),
			// Without the meta the chemicals show no badges.
			() => {}
		);
		return () => controller.abort();
	});

	const links = $derived(sectionLinks(meta ?? undefined, props.id, period, filters, noticesDay));

	const info = $derived(figures.find((f) => f.id === figure));
	const field = $derived(useField(figure));
	const pad = (n: number) => String(n).padStart(2, "0");
	const monthName = (month: number) => formatMonthName(`${period.year}-${pad(month)}-01`);

	/** The shown figure by month (the response's 12 rows, zero-filled). */
	const months = $derived(
		detail && field ? detail.months.map((row) => ({ month: row.month, value: row[field] })) : []
	);
	const most = $derived(Math.max(0, ...months.map((row) => row.value)));
	const peak = $derived(peakMonth(months));
	const chemicals = $derived(detail ? topChemicals(detail.top_chemicals) : []);

	/** A chemical's badges as the meta labels them, in the meta's order. */
	function badgesOf(keys: string[]): { key: string; label: string }[] {
		return (meta?.badges ?? []).filter((badge) => keys.includes(badge.key));
	}

	/**
	 * The interactive card scrolls when its months and chemicals don't fit, so it is a Tab stop
	 * (a scrollable region the keyboard can scroll), named for its section. The hover form takes
	 * no focus.
	 */
	const linkClass =
		"text-link focus-visible:ring-ring rounded-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none";
	const focusTarget = $derived(
		interactive ? { tabindex: 0, role: "group", "aria-label": props.name } : {}
	);
</script>

<div
	{...focusTarget}
	class={[
		"flex flex-col gap-2",
		interactive &&
			"mapsdk-tooltip-wide focus-visible:ring-ring max-h-80 overflow-y-auto rounded-sm focus-visible:ring-2 focus-visible:outline-none"
	]}
	data-use-card={interactive ? "section" : "section-hover"}
>
	<div>
		<h3 class="font-semibold">{props.name}</h3>
		{#if props.county}
			<p class="text-muted-foreground">{props.county}</p>
		{/if}
	</div>
	{#if filtersLine}
		<p class="text-muted-foreground text-xs">
			{m.map_use_legend_filters({ filters: filtersLine })}
		</p>
	{/if}
	<UseCardFigures {props} {figure} {figures} {period} {scale} />
	{#if township}
		{@const [before, after] = townshipLineParts(township)}
		<p class="text-sm">
			{before}{#if interactive && township.pinnable && ontownship}<button
					type="button"
					class={linkClass}
					aria-label={m.map_use_card_township_open({ township: township.id })}
					onclick={ontownship}>{township.id}</button
				>{:else}{township.id}{/if}{after}
		</p>
	{/if}
	{#if interactive && info}
		{#if failed}
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<p>{m.map_use_card_detail_failed()}</p>
				<button
					type="button"
					class="text-link focus-visible:ring-ring rounded-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
					onclick={() => tries++}
				>
					{m.widget_state_retry()}
				</button>
			</div>
		{:else if !detail}
			<div class="flex flex-col gap-1" aria-busy="true" data-use-detail-loading>
				<span class="sr-only">{m.map_use_card_loading()}</span>
				<div class="bg-muted h-12 rounded-sm motion-safe:animate-pulse"></div>
				<div class="bg-muted h-3 w-2/3 rounded-sm motion-safe:animate-pulse"></div>
			</div>
		{:else}
			<div class="flex flex-col gap-1">
				<p class="text-muted-foreground text-xs">
					{m.map_use_card_months({ year: String(period.year) })}
				</p>
				<div class="border-border flex h-12 items-end gap-0.5 border-b" aria-hidden="true">
					{#each months as row (row.month)}
						<div class="flex h-full flex-1 items-end">
							<div
								class="w-full rounded-t-sm bg-(--map-use-bar)"
								style:height={most > 0 ? `${(row.value / most) * 100}%` : "0%"}
								data-use-bar
							></div>
						</div>
					{/each}
				</div>
				<ul class="sr-only" data-use-months>
					{#each months as row (row.month)}
						<li>
							{m.map_use_card_month_row({
								month: monthName(row.month),
								value: formatValue(row.value, info.precision),
								units: info.units
							})}
						</li>
					{/each}
				</ul>
				{#if peak !== null}
					<p class="text-sm">{m.map_use_card_peak({ month: monthName(peak) })}</p>
				{/if}
			</div>
			{#if chemicals.length > 0}
				<div class="flex flex-col gap-1">
					<p class="font-medium">{m.map_use_card_top_chemicals()}</p>
					<ul class="flex flex-col gap-1">
						{#each chemicals as chemical (chemical.id)}
							{@const chemicalHref = chemicalLink(meta ?? undefined, chemical.id, period, filters)}
							<li class="flex flex-wrap items-center gap-1" data-use-chemical={chemical.id}>
								{#if chemicalHref}
									<a
										href={chemicalHref}
										target="_blank"
										rel="noopener noreferrer"
										class={linkClass}
									>
										{chemical.display_name}
										<ExternalLinkCue class="inline size-3 align-baseline" />
									</a>
								{:else}
									<span>{chemical.display_name}</span>
								{/if}
								{#each badgesOf(chemical.badges) as badge (badge.key)}
									<span
										class="border-border text-foreground rounded-sm border px-1 text-xs font-medium"
										data-use-badge>{badge.label}</span
									>
								{/each}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		{/if}
		{#if links.page || links.records || links.notices}
			<ul class="flex flex-wrap gap-x-3 gap-y-1 text-sm" data-use-links>
				{#each [[links.page, m.map_use_card_link_section()], [links.records, m.map_use_card_link_records()], [links.notices, m.map_use_card_link_notices()]] as [href, text] (text)}
					{#if href}
						<li>
							<a {href} target="_blank" rel="noopener noreferrer" class={linkClass}>
								{text}
								<ExternalLinkCue class="inline size-3 align-baseline" />
							</a>
						</li>
					{/if}
				{/each}
			</ul>
		{/if}
	{/if}
</div>
