<script lang="ts">
	import type { MonitorGroup } from "@sjvair/sdk";
	import { tick } from "svelte";
	import X from "@lucide/svelte/icons/x";
	import { Button } from "$lib/components/ui/button";
	import { getMetadata } from "$lib/data";
	import { AIR_QUALITY, isPollutantLayer } from "$lib/data/layer-kind";
	import type {
		CatalogEntry,
		EntryTypeMeta,
		MonitorSummary,
		MonitorTypeInfo
	} from "$lib/data/metadata";
	import type { WidgetDataConfig } from "$lib/data/schema";
	import { m } from "$lib/paraglide/messages.js";
	import { report } from "$lib/safety/report";
	import { DEFAULT_LAYER } from "$lib/widgets/defaults";
	import type { EntryPick } from "./layers";
	import {
		monitorGroups,
		monitorRows,
		type MonitorBlock,
		type MonitorRow
	} from "./monitor-choices";
	import MonitorsControl from "./MonitorsControl.svelte";

	/**
	 * The Air quality section (spec decisions 4, 6, 7, 31–33, 36): the pollutant radios with None
	 * (or, with `multiple`, a checkbox per pollutant), then Monitors: a checkbox per monitor type in the monitors meta's groups, the searched
	 * monitors' list (each removable) and the Monitors search. A single-place widget shows only the
	 * search (one monitor). With None the ticks and monitors stay, greyed out with their reason; a
	 * type or monitor that doesn't measure the pollutant is greyed out with its reason, kept. Greyed
	 * means it can't be newly ticked and isn't fetched: a ticked one can always be unticked.
	 */
	let {
		data,
		catalog,
		limit,
		pollutants,
		pollutantReason,
		capText,
		strip = false,
		none = true,
		multiple = false,
		onpollutant,
		onpollutants,
		ontypes,
		onmonitors
	}: {
		/** The draft's data (plain). */
		data: WidgetDataConfig;
		catalog: CatalogEntry[];
		/** How many places the widget type takes (`placeLimit`): 1 shows only the search. */
		limit: number;
		/** The pollutant radios, in order; `null` when the pollutant is chosen elsewhere. */
		pollutants: EntryTypeMeta[] | null;
		/** Why a pollutant can't be chosen (greyed with the reason), or undefined. */
		pollutantReason?: (entry: EntryTypeMeta) => string | undefined;
		/** Set when no pollutant can be added (one layer too many): every pollutant greyed with it. */
		capText?: string;
		/**
		 * A Forecast strip (spec decision 11, ruling R11): its one monitor is on its own forecasts
		 * layer and is searched as PM2.5's are (it has no pollutant of its own).
		 */
		strip?: boolean;
		/** Offers None among the pollutants (Current conditions always has one, decision 4). */
		none?: boolean;
		/**
		 * Several pollutants (Current conditions): a checkbox each, in the order given, with no None;
		 * none greyed out (unticking the last is allowed). `onpollutants` replaces `onpollutant`.
		 */
		multiple?: boolean;
		/** A pollutant, or `null` for None (without `multiple`). */
		onpollutant?: (pick: EntryPick | null) => void;
		/** With `multiple`: the ticked pollutants' entry types after a change, in the order ticked. */
		onpollutants?: (entryTypes: string[]) => void;
		/** The ticked monitor types after a change. */
		ontypes: (types: string[]) => void;
		/** The searched monitors after a change. */
		onmonitors: (ids: string[]) => void;
	} = $props();

	const uid = $props.id();
	const noPollutantId = `${uid}-no-pollutant`;
	const searchReasonId = `${uid}-search-reason`;
	const capId = `${uid}-cap`;

	const layer = $derived(
		strip ? data.layers[0] : data.layers.find((l) => isPollutantLayer(l, catalog))
	);
	const entryType = $derived(strip ? DEFAULT_LAYER.entryType : layer?.entryType);
	const ticked = $derived(layer?.monitorTypes ?? []);
	/** With `multiple`: the ticked pollutants, in layer order. */
	const pollutantsTicked = $derived(
		multiple
			? data.layers.flatMap((l) => (l.dataset === AIR_QUALITY && l.entryType ? [l.entryType] : []))
			: []
	);
	const ids = $derived(layer?.monitors ?? []);
	const single = $derived(limit === 1);
	const aq = $derived(catalog.find((c) => c.id === AIR_QUALITY));
	const pollutantLabel = $derived(
		aq?.entryTypes.find((e) => e.id === entryType)?.label ?? entryType ?? ""
	);

	type Meta = { types: MonitorTypeInfo[]; groups: MonitorGroup[] | null; list: MonitorSummary[] };
	/** The monitors meta and list; undefined while loading (a part that fails is left empty). */
	let meta = $state.raw<Meta | undefined>(undefined);
	$effect(() => {
		const controller = new AbortController();
		const { signal } = controller;
		const source = getMetadata();
		const settle = <T,>(p: Promise<T>, empty: T): Promise<T> =>
			p.catch((error: unknown) => {
				if (!signal.aborted) report(error);
				return empty;
			});
		void Promise.all([
			settle(source.monitorTypes(signal), [] as MonitorTypeInfo[]),
			settle(source.monitorGroups(signal), null),
			settle(source.monitors(signal), [] as MonitorSummary[])
		]).then(([types, groups, list]) => {
			if (!signal.aborted) meta = { types, groups, list };
		});
		return () => controller.abort();
	});

	/** The catalog's types (the bulk `type` ids), plus any ticked it no longer lists. */
	const offered = $derived([
		...(aq?.monitorTypes ?? []),
		...ticked.filter((t) => !aq?.monitorTypes?.includes(t))
	]);
	const groups = $derived(meta ? monitorGroups(meta.groups, meta.types, entryType, offered) : []);
	const rows = $derived<MonitorRow[]>(
		meta
			? monitorRows(ids, meta.list, meta.types, entryType)
			: ids.map((id) => ({ id, name: m.get_data_monitors_loading(), network: null }))
	);
	const anyBlockedNoPollutant = $derived(
		entryType === undefined && (rows.length > 0 || (!single && groups.length > 0))
	);

	let list = $state<HTMLElement | null>(null);
	let addButton = $state<HTMLButtonElement | null>(null);

	function reasonOf(blocked: MonitorBlock | undefined, id: string): string | undefined {
		if (blocked === "no-pollutant") return noPollutantId;
		if (blocked === "not-supplied") return id;
		return undefined;
	}

	/** Ticks a pollutant on (after those ticked) or off. */
	function togglePollutant(id: string, on: boolean): void {
		const next = on
			? [...pollutantsTicked.filter((e) => e !== id), id]
			: pollutantsTicked.filter((e) => e !== id);
		onpollutants?.(next);
	}

	function toggleType(type: string, on: boolean): void {
		const next = on ? [...ticked, type] : ticked.filter((t) => t !== type);
		ontypes(offered.filter((t) => next.includes(t)));
	}

	/** Removes a listed monitor; focus moves to the next row, else to the search's button. */
	async function remove(id: string, index: number): Promise<void> {
		onmonitors(ids.filter((x) => x !== id));
		await tick();
		const buttons = list?.querySelectorAll<HTMLElement>("[data-monitor-remove]") ?? [];
		(buttons[index] ?? buttons[index - 1] ?? addButton)?.focus();
	}
</script>

{#snippet reason(id: string, text: string)}
	<span {id} class="text-muted-foreground text-xs">{text}</span>
{/snippet}

<div class="flex flex-col gap-3">
	{#if pollutants && multiple}
		<fieldset class="flex flex-col gap-1">
			<legend class="sr-only">{aq?.label ?? AIR_QUALITY}</legend>
			{#each pollutants as entry (entry.id)}
				<label class="flex min-h-6 items-center gap-2 text-sm">
					<input
						type="checkbox"
						class="accent-primary size-4"
						checked={pollutantsTicked.includes(entry.id)}
						onchange={(e) => togglePollutant(entry.id, e.currentTarget.checked)}
					/>
					<span>{entry.label}</span>
				</label>
			{/each}
		</fieldset>
	{:else if pollutants}
		<fieldset class="flex flex-col gap-1">
			<legend class="sr-only">{aq?.label ?? AIR_QUALITY}</legend>
			{#if none}
				<label class="flex min-h-6 items-center gap-2 text-sm">
					<input
						type="radio"
						class="accent-primary size-4"
						name="{uid}-pollutant"
						value=""
						checked={!layer?.entryType}
						onchange={() => onpollutant?.(null)}
					/>
					<span>{m.get_data_none()}</span>
				</label>
			{/if}
			{#each pollutants as entry (entry.id)}
				{@const checked = entryType === entry.id}
				{@const capped = !checked && !!capText && !layer?.entryType}
				{@const why = checked || capped ? undefined : pollutantReason?.(entry)}
				{@const whyId = `${uid}-${entry.id}-reason`}
				<div class="flex min-h-6 flex-wrap items-center gap-x-2 text-sm">
					<label class="flex items-center gap-2">
						<input
							type="radio"
							class="accent-primary size-4"
							name="{uid}-pollutant"
							value={entry.id}
							{checked}
							disabled={capped || !!why}
							aria-describedby={capped ? capId : why ? whyId : undefined}
							onchange={() => onpollutant?.({ dataset: AIR_QUALITY, entryType: entry.id })}
						/>
						<span class={[(capped || why) && "text-muted-foreground"]}>{entry.label}</span>
					</label>
					{#if why}
						{@render reason(whyId, why)}
					{/if}
				</div>
			{/each}
			{#if capText && !layer?.entryType}
				{@render reason(capId, capText)}
			{/if}
		</fieldset>
	{/if}

	<div role="group" aria-labelledby="{uid}-monitors" class="flex flex-col gap-2">
		<h3 id="{uid}-monitors" class="text-sm font-medium">{m.get_data_monitors()}</h3>
		{#if anyBlockedNoPollutant}
			<p id={noPollutantId} class="text-muted-foreground text-xs">
				{m.get_data_monitor_type_no_pollutant()}
			</p>
		{/if}
		{#if !single}
			{#each groups as group (group.key)}
				<fieldset class="flex flex-col gap-1">
					<legend class="text-muted-foreground text-xs">{group.label}</legend>
					{#each group.types as choice (choice.type)}
						{@const notSuppliedId = `${uid}-type-${choice.type}-reason`}
						<div class="flex min-h-6 flex-wrap items-center gap-x-2 text-sm">
							<label class="flex items-center gap-2">
								<input
									type="checkbox"
									class="accent-primary size-4"
									checked={ticked.includes(choice.type)}
									disabled={!!choice.blocked && !ticked.includes(choice.type)}
									aria-describedby={reasonOf(choice.blocked, notSuppliedId)}
									onchange={(e) => toggleType(choice.type, e.currentTarget.checked)}
								/>
								<span class={[choice.blocked && "text-muted-foreground"]}>{choice.label}</span>
							</label>
							{#if choice.blocked === "not-supplied"}
								{@render reason(
									notSuppliedId,
									m.get_data_monitor_type_not_supplied({ pollutant: pollutantLabel })
								)}
							{/if}
						</div>
					{/each}
				</fieldset>
			{/each}
		{/if}
		{#if rows.length > 0}
			<ul bind:this={list} aria-label={m.get_data_monitors_picked()} class="flex flex-col gap-1">
				{#each rows as row, index (row.id)}
					{@const notSuppliedId = `${uid}-monitor-${row.id}-reason`}
					<li class="flex min-h-6 flex-wrap items-center gap-x-2 text-sm">
						<span class={["min-w-0 flex-1", row.blocked && "text-muted-foreground"]}>
							{row.network
								? m.get_data_monitors_row({ name: row.name, network: row.network })
								: row.name}
						</span>
						<Button
							variant="ghost"
							size="icon-sm"
							data-monitor-remove
							aria-label={m.get_data_monitors_remove_label({ name: row.name })}
							aria-describedby={reasonOf(row.blocked, notSuppliedId)}
							onclick={() => void remove(row.id, index)}
						>
							<X aria-hidden="true" />
						</Button>
						{#if row.blocked === "not-supplied"}
							<span id={notSuppliedId} class="text-muted-foreground w-full text-xs">
								{m.get_data_monitor_type_not_supplied({ pollutant: pollutantLabel })}
							</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		<MonitorsControl
			bind:ref={addButton}
			{ids}
			{single}
			purpose={entryType
				? { dataset: strip ? DEFAULT_LAYER.dataset : (layer?.dataset ?? AIR_QUALITY), entryType }
				: undefined}
			reasonId={searchReasonId}
			onchange={onmonitors}
		/>
		{#if !entryType}
			{@render reason(searchReasonId, m.get_data_monitors_choose_pollutant())}
		{/if}
	</div>
</div>
