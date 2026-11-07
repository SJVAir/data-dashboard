<script lang="ts">
	import { getContext, type Snippet } from "svelte";
	import { removeWidget } from "$lib/actions/widget";
	import { Button } from "$lib/components/ui/button";
	import type { WidgetDataConfig } from "$lib/data/schema";
	import type { QueryData, QueryState } from "$lib/data/types";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatDate } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { getWidgetType } from "$lib/widgets/registry";
	import { navigate } from "../../../router";
	import { REMOVE_WIDGET_KEY } from "./context";
	import { withReplacements } from "./retired";
	import WidgetSkeleton from "./WidgetSkeleton.svelte";

	let {
		state,
		widget,
		retired,
		onretry,
		onchoose,
		emptyText,
		children
	}: {
		state: QueryState;
		widget: WidgetInstance;
		/** The catalog's retirement of the dataset or entry type the widget reads, with its name. */
		retired?: { name: string; since: string };
		onretry: () => void;
		/**
		 * Opens the place picker; "Choose a place" (idle) and "Choose another" (for a place) show
		 * only when this is given and editing. "Choose another" for a retired dataset or entry type
		 * opens Edit data instead.
		 */
		onchoose?: () => void;
		/** What an empty range says instead of the general "No data for this range." */
		emptyText?: string;
		children: Snippet<[QueryData]>;
	} = $props();

	const app = useApp();
	const remove =
		getContext<(() => void) | undefined>(REMOVE_WIDGET_KEY) ?? (() => removeWidget(app, widget.id));

	/** Reasons for which the saved place is gone: the "no longer available" card. */
	const GONE = new Set([
		"region-unresolved",
		"location-unresolved",
		"monitor-unlisted",
		"filter-gone"
	]);

	const UNAVAILABLE = {
		"catalog-unavailable": () => m.widget_state_unavailable_catalog_unavailable(),
		"unknown-dataset": () => m.widget_state_unavailable_unknown_dataset(),
		"unknown-entry-type": () => m.widget_state_unavailable_unknown_entry_type(),
		"no-adapter": () => m.widget_state_unavailable_no_adapter(),
		"no-resolution": () => m.widget_state_unavailable_no_resolution(),
		"place-unsupported": () => m.widget_state_unavailable_place_unsupported(),
		"point-outside": () => m.widget_state_unavailable_point_outside(),
		"whole-layer-raw": () => m.widget_state_unavailable_whole_layer_raw()
	};

	/** A retirement's `since` (a date or a date-time) as a Pacific date. */
	function sinceText(since: string): string {
		return formatDate(/^\d{4}-\d{2}-\d{2}$/.test(since) ? since : new Date(since));
	}

	const data = $derived<QueryData | undefined>("data" in state ? state.data : undefined);
	const allPlaces = $derived(data?.places ?? []);
	const retiredPlaces = $derived(allPlaces.filter((p) => p.retired));
	/** Places reached through a retired school (the school's note, not the region's). */
	const retiredSchools = $derived(
		allPlaces.filter((p) => p.via?.kind === "location" && p.via.retired)
	);
	const replacement = $derived<WidgetDataConfig | null>(withReplacements(widget.data, allPlaces));
	const empty = $derived(!!data && data.series.every((s) => !s.points.length));
	const editable = $derived(!!app.current.session && !app.current.session.readOnly);
	/** The one note that carries Switch (it applies every replacement together). */
	const switchOn = $derived.by(() => {
		if (!replacement || !editable) return undefined;
		const region = retiredPlaces.find((p) => p.retired?.replacedBy);
		if (region) return region.place;
		return retiredSchools.find((p) => p.via?.kind === "location" && p.via.retired?.replacedBy)
			?.place;
	});

	/** Edit data can change what a retired dataset or entry type was: types Get data shows. */
	const editsData = $derived(editable && !!getWidgetType(widget.type)?.accepts?.datasets?.length);

	/** "Choose another" for a retired dataset or entry type: Edit data on this widget. */
	function chooseAnotherDataset(): void {
		const session = app.current.session;
		if (!session || session.readOnly) return;
		void navigate("/dashboards/:id/widgets/:widgetId/edit", {
			params: { id: session.doc.id, widgetId: widget.id }
		});
	}

	function switchToReplacement(): void {
		const session = app.current.session;
		if (!session || session.readOnly || !replacement) return;
		const current = session.doc.body.widgets.find((w) => w.id === widget.id);
		if (!current) return;
		session.apply({
			op: "setWidgetData",
			target: { widgetId: widget.id },
			from: current.data,
			to: replacement
		});
	}
</script>

{#snippet message(text: string)}
	<p class="text-muted-foreground flex h-full items-center justify-center text-center text-sm">
		{text}
	</p>
{/snippet}

{#snippet note(text: string, action?: Snippet)}
	<p
		class="bg-muted text-muted-foreground mb-2 flex flex-wrap items-center gap-2 rounded-(--radius-control) px-2 py-1 text-sm"
	>
		<span>{text}</span>
		{@render action?.()}
	</p>
{/snippet}

{#snippet chooseAnotherButton()}
	<Button size="sm" variant="outline" onclick={chooseAnotherDataset}>
		{m.widget_state_choose_another()}
	</Button>
{/snippet}

{#snippet switchButton()}
	<Button size="sm" variant="outline" onclick={switchToReplacement}>
		{m.widget_state_switch()}
	</Button>
{/snippet}

{#snippet notes()}
	{#if retired}
		{@render note(
			m.widget_state_dataset_retired({ dataset: retired.name, date: sinceText(retired.since) }),
			editsData ? chooseAnotherButton : undefined
		)}
	{/if}
	{#each retiredPlaces as p (p.place)}
		{@render note(
			m.widget_state_place_retired({ place: p.name, date: sinceText(p.retired!.since) }),
			p.place === switchOn ? switchButton : undefined
		)}
	{/each}
	{#each retiredSchools as p (p.place)}
		{#if p.via?.kind === "location" && p.via.retired}
			{@render note(
				m.widget_state_location_retired({
					name: p.via.name,
					date: sinceText(p.via.retired.since)
				}),
				p.place === switchOn ? switchButton : undefined
			)}
		{/if}
	{/each}
{/snippet}

{#if state.status === "idle"}
	{#if editable && onchoose}
		<div class="flex h-full flex-col items-center justify-center gap-2 text-center">
			<p class="text-muted-foreground text-sm">{m.widget_state_idle()}</p>
			<Button size="sm" variant="outline" onclick={onchoose}>
				{m.widget_state_choose_place()}
			</Button>
		</div>
	{:else}
		{@render message(m.widget_state_idle())}
	{/if}
{:else if state.status === "unavailable"}
	{#if GONE.has(state.reason)}
		<div class="flex h-full flex-col items-center justify-center gap-2 text-center">
			{#if state.reason === "filter-gone"}
				<p class="text-sm font-medium">{m.widget_state_unavailable_filter_gone()}</p>
			{:else}
				<p class="text-sm font-medium">{m.widget_state_gone_title()}</p>
				<p class="text-muted-foreground text-sm">{m.widget_state_gone_body()}</p>
			{/if}
			{#if editable}
				<div class="flex flex-wrap items-center justify-center gap-2">
					{#if state.reason === "filter-gone"}
						<!-- A new place can't bring a filter back: Edit data can. -->
						{#if editsData}
							{@render chooseAnotherButton()}
						{/if}
					{:else if onchoose}
						<Button size="sm" variant="outline" onclick={onchoose}>
							{m.widget_state_choose_another()}
						</Button>
					{/if}
					<Button size="sm" variant="outline" onclick={remove}>
						{m.widget_state_remove()}
					</Button>
				</div>
			{/if}
		</div>
	{:else if state.reason === "point-outside"}
		<div class="flex h-full flex-col items-center justify-center gap-2 text-center">
			<p class="text-muted-foreground text-sm">{UNAVAILABLE[state.reason]()}</p>
			{#if editable && onchoose}
				<Button size="sm" variant="outline" onclick={onchoose}>
					{m.widget_state_choose_another()}
				</Button>
			{/if}
		</div>
	{:else}
		{@render message(UNAVAILABLE[state.reason as keyof typeof UNAVAILABLE]())}
	{/if}
{:else if state.status === "error" && !data}
	<div class="flex h-full flex-col items-center justify-center gap-2 text-center">
		<p class="text-muted-foreground text-sm">{m.widget_state_error()}</p>
		<Button size="sm" variant="outline" onclick={onretry}>{m.widget_state_retry()}</Button>
	</div>
{:else if state.status === "loading" && !data}
	<WidgetSkeleton />
{:else if data}
	<div class="flex h-full flex-col">
		{#if state.status === "error"}
			{@render note(m.widget_state_error(), retryButton)}
		{/if}
		{@render notes()}
		{#if empty}
			{@render message(emptyText ?? m.widget_state_empty())}
		{:else}
			<div class="min-h-0 flex-1">{@render children(data)}</div>
		{/if}
	</div>
{/if}

{#snippet retryButton()}
	<Button size="sm" variant="outline" onclick={onretry}>{m.widget_state_retry()}</Button>
{/snippet}
