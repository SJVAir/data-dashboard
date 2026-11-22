<script lang="ts">
	import { getContext } from "svelte";
	import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatList } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { markKey } from "$lib/thresholds/marks.svelte";
	import { hasPlaces } from "../shared/input";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "../shared/viewer";
	import WidgetState from "../shared/WidgetState.svelte";
	import { placeLabel } from "../title";
	import { setGeneratedTitle } from "../titles.svelte";
	import CurrentRow, { type RowReport } from "./CurrentRow.svelte";
	import { currentPollutants, onePollutant } from "./pollutants";

	let { widget }: { widget: WidgetInstance } = $props();

	const uid = $props.id();
	const viewer = getContext<PlaceViewer | undefined>(PLACE_VIEWER_KEY) ?? "owner";

	const pollutants = $derived(currentPollutants(widget.data));
	const rows = $derived(pollutants.map((e) => ({ entryType: e, widget: onePollutant(widget, e) })));
	const several = $derived(pollutants.length > 1);

	/** Each row's name and place, by entry type (for the title). */
	let reports = $state<Record<string, RowReport | undefined>>({});

	function report(entryType: string, r: RowReport | undefined): void {
		if (r) reports[entryType] = r;
		else delete reports[entryType];
	}

	/** The generated title, once every row's pollutant is named and a row has read its place. */
	$effect(() => {
		const known = pollutants.map((e) => reports[e]);
		if (known.length === 0 || known.some((r) => !r)) return;
		const place = known.find((r) => r?.place)?.place;
		if (!place) return;
		const labels = known.map((r) => r!.label);
		const first = labels.length === 1 ? labels[0] : formatList(labels);
		setGeneratedTitle(widget.id, m.label_join({ first, second: placeLabel(place, viewer) }));
	});
</script>

{#snippet nothing()}{/snippet}

{#if pollutants.length === 0}
	<p class="text-muted-foreground flex h-full items-center justify-center text-center text-sm">
		{m.current_choose_pollutant()}
	</p>
{:else if !hasPlaces(widget.data)}
	<WidgetState
		state={{ status: "idle" }}
		{widget}
		onretry={() => {}}
		onchoose={() => openPlacePicker({ widgetId: widget.id })}
		idleText={m.widget_state_idle_place_or_monitor()}
		children={nothing}
	/>
{:else}
	<!-- Several rows can overflow with nothing focusable in them: the column takes focus to scroll. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="flex h-full flex-col overflow-y-auto"
		tabindex={several ? 0 : undefined}
		role={several ? "region" : undefined}
		aria-label={several ? m.current_rows_label() : undefined}
	>
		{#each rows as row (row.entryType)}
			<div
				data-pollutant={row.entryType}
				role={several ? "group" : undefined}
				aria-labelledby={several ? `${uid}-${row.entryType}` : undefined}
				class={several ? "border-border min-h-36 flex-1 shrink-0 not-first:border-t" : "h-full"}
			>
				<CurrentRow
					widget={row.widget}
					markKey={markKey(widget.id, row.entryType)}
					named={several}
					headingId={`${uid}-${row.entryType}`}
					onreport={(r) => report(row.entryType, r)}
				/>
			</div>
		{/each}
	</div>
{/if}
