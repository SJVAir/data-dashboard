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
	import { REMOVE_WIDGET_KEY } from "./context";
	import { withReplacements } from "./retired";
	import WidgetSkeleton from "./WidgetSkeleton.svelte";

	let {
		state,
		widget,
		retired,
		onretry,
		children
	}: {
		state: QueryState;
		widget: WidgetInstance;
		/** The catalog's retirement of the dataset or entry type the widget reads, with its name. */
		retired?: { name: string; since: string };
		onretry: () => void;
		children: Snippet<[QueryData]>;
	} = $props();

	const app = useApp();
	const remove =
		getContext<(() => void) | undefined>(REMOVE_WIDGET_KEY) ?? (() => removeWidget(app, widget.id));

	const UNAVAILABLE = {
		"catalog-unavailable": () => m.widget_state_unavailable_catalog_unavailable(),
		"unknown-dataset": () => m.widget_state_unavailable_unknown_dataset(),
		"unknown-entry-type": () => m.widget_state_unavailable_unknown_entry_type(),
		"no-adapter": () => m.widget_state_unavailable_no_adapter(),
		"no-resolution": () => m.widget_state_unavailable_no_resolution(),
		"place-unsupported": () => m.widget_state_unavailable_place_unsupported(),
		"whole-layer-raw": () => m.widget_state_unavailable_whole_layer_raw()
	};

	/** A retirement's `since` (a date or a date-time) as a Pacific date. */
	function sinceText(since: string): string {
		return formatDate(/^\d{4}-\d{2}-\d{2}$/.test(since) ? since : new Date(since));
	}

	const data = $derived<QueryData | undefined>("data" in state ? state.data : undefined);
	const allPlaces = $derived(data?.places ?? []);
	const retiredPlaces = $derived(allPlaces.filter((p) => p.retired));
	const replacement = $derived<WidgetDataConfig | null>(withReplacements(widget.data, allPlaces));
	const empty = $derived(!!data && data.series.every((s) => !s.points.length));
	const editable = $derived(!!app.current.session && !app.current.session.readOnly);
	/** The one note that carries Switch (it applies every replacement together). */
	const switchOn = $derived(
		replacement && editable ? retiredPlaces.find((p) => p.retired?.replacedBy)?.place : undefined
	);

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

{#snippet notes()}
	{#if retired}
		{@render note(
			m.widget_state_dataset_retired({ dataset: retired.name, date: sinceText(retired.since) })
		)}
	{/if}
	{#each retiredPlaces as p (p.place)}
		{#snippet switchButton()}
			<Button size="sm" variant="outline" onclick={switchToReplacement}>
				{m.widget_state_switch()}
			</Button>
		{/snippet}
		{@render note(
			m.widget_state_place_retired({ place: p.name, date: sinceText(p.retired!.since) }),
			p.place === switchOn ? switchButton : undefined
		)}
	{/each}
{/snippet}

{#if state.status === "idle"}
	{@render message(m.widget_state_idle())}
{:else if state.status === "unavailable"}
	{#if state.reason === "region-unresolved"}
		<div class="flex h-full flex-col items-center justify-center gap-2 text-center">
			<p class="text-sm font-medium">{m.widget_state_gone_title()}</p>
			<p class="text-muted-foreground text-sm">{m.widget_state_gone_body()}</p>
			{#if editable}
				<Button size="sm" variant="outline" onclick={remove}>
					{m.widget_state_remove()}
				</Button>
			{/if}
		</div>
	{:else}
		{@render message(UNAVAILABLE[state.reason]())}
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
			{@render message(m.widget_state_empty())}
		{:else}
			<div class="min-h-0 flex-1">{@render children(data)}</div>
		{/if}
	</div>
{/if}

{#snippet retryButton()}
	<Button size="sm" variant="outline" onclick={onretry}>{m.widget_state_retry()}</Button>
{/snippet}
