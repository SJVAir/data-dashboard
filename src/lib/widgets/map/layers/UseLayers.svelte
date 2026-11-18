<script lang="ts">
	import { untrack, type Snippet } from "svelte";
	import {
		shapesLens,
		shapesPlugin,
		type CardContext,
		type FeatureListItem,
		type MapContext,
		type ShapesLens
	} from "@sjvair/map-sdk";
	import type { DataSource } from "@sjvair/map-sdk/data";
	import { filterSummary } from "$lib/data/pesticide-meta";
	import { formatValue } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { filtersKey } from "../data/filters-key";
	import { useField, type UseProps, type UseQuery } from "../data/use";
	import { useScaleFor } from "../data/use-scale";
	import { joinLabels, type UseFigure } from "../use-card";
	import type { NoticesDay } from "../section-links";
	import { useTooltips } from "../use-tooltip";
	import { beforeIn } from "./order";

	/**
	 * Pesticide use's three plugins, `[townships, lens, sections]`, above the fill and under the
	 * focus area (`UNDER_FOCUS`), added while use is drawn; renders nothing. The townships draw below the section
	 * zoom and the sections from it; the lens opens a township's block into sections on hover.
	 * Each draws its features' cards (`useTooltips`). A section's card names its township, a button
	 * in the card's actions (`oncardactions`) that pins the township's card in its place.
	 */
	let {
		map,
		townships,
		sections,
		lensSource,
		block,
		parentOf,
		label,
		units,
		zoom,
		queryKey,
		query,
		figures,
		drawn,
		loads,
		note,
		onlens,
		noticesDay = null,
		oncardactions,
		lens = $bindable(null)
	}: {
		map: MapContext;
		townships: DataSource<UseProps>;
		sections: DataSource<UseProps>;
		/** The lens block's sections. */
		lensSource: DataSource<UseProps>;
		/** The township refKeys of the block centred on a township's refKey. */
		block: (refKey: string) => string[];
		/** A section's township refKey. */
		parentOf: (props: UseProps) => string | null;
		/** The layer label ("Pounds Applied, 2023"); none, nothing is drawn. */
		label: string | undefined;
		/** The figure's units (the catalog's), for the legend's units lines. */
		units: string;
		/** The section zoom: townships below it, sections from it. */
		zoom: number;
		/** What use draws (the figure, the period and the filters), as a key. */
		queryKey: string | null;
		/** What use draws; read when the plugins are made (`queryKey` remakes them). */
		query: UseQuery | null;
		/** The catalog's figures the map draws, for the cards. */
		figures: UseFigure[];
		/** Whether use is on the map. */
		drawn: boolean;
		/** Whether the tile loads its data. */
		loads: boolean;
		/** The legend section's note. */
		note: Snippet;
		/** The township the lens is centred on (null when it drops, or with no lens). */
		onlens: (center: string | null) => void;
		/** The past day the notices layer shows (the section card's "Notices here" link). */
		noticesDay?: NoticesDay | null;
		/**
		 * Gets use's part of MapView's card actions (null when this goes): a section's "In
		 * township" button.
		 */
		oncardactions?: (actions: Snippet<[CardContext]> | null) => void;
		/** The lens plugin while it's on the map (the township card pins and releases it). */
		lens?: ShapesLens | null;
	} = $props();

	/** Each township's and section's latest properties, by refKey: an open card follows them. */
	const byRef = $derived(
		new Map(
			[townships, lensSource, sections].flatMap((source) =>
				(source.features?.features ?? []).map((f) => [f.properties.refKey, f.properties] as const)
			)
		)
	);

	/**
	 * A section's township, for its card's "In township ‹id› · ‹figure›" line: the figure the map
	 * shows, from the loaded townships (by `parentOf`). `listed` when the townships hold it (it can
	 * be pinned); null for a township.
	 */
	function townshipOf(props: UseProps): { refKey: string; text: string; listed: boolean } | null {
		const refKey = parentOf(props);
		if (!refKey) return null;
		const parent = byRef.get(refKey);
		const figure = query?.figure;
		const info = figures.find((f) => f.id === figure);
		const field = figure ? useField(figure) : undefined;
		const value = parent && field ? parent[field] : null;
		const text =
			info && value !== null
				? m.map_use_card_in_township({
						township: props.township,
						value: formatValue(value, info.precision),
						units: info.units
					})
				: m.map_use_card_in_township_no_figure({ township: props.township });
		return { refKey, text, listed: parent?.level === "township" };
	}

	$effect(() => {
		const report = oncardactions;
		report?.(cardActions);
		return () => report?.(null);
	});

	/** The active filters' names, for the cards' "Filtered by" line. */
	let filtersLine = $state<string | null>(null);
	const filters = $derived(filtersKey(query?.filters ?? {}));
	$effect(() => {
		const saved = JSON.parse(filters) as UseQuery["filters"];
		const controller = new AbortController();
		filterSummary(saved, controller.signal).then(
			(labels) => (filtersLine = joinLabels(labels)),
			// A gone filter is the map's own note; any other failure leaves the line out.
			() => {
				if (!controller.signal.aborted) filtersLine = null;
			}
		);
		return () => controller.abort();
	});

	// Made again only when the zoom, the figure or the query changes: a plugin belongs to one map
	// and one set of options.
	$effect(() => {
		const current = map;
		const layerLabel = label;
		const z = zoom;
		const legendNote = note;
		const unitsOf = units;
		void queryKey;
		const q = untrack(() => query);
		const catalog = untrack(() => figures);
		if (!layerLabel || !loads || !drawn || !q) return;
		// The lens, once made: "Show square miles" pins it.
		let made: ShapesLens | null = null;
		const cards = useTooltips({
			current: (refKey) => byRef.get(refKey),
			scale: (props) => {
				const ref = props.level === "township" ? townships.scale : sections.scale;
				// The use block's sources hold a ref, registered before they expose it.
				if (!ref) return null;
				return "dataset" in ref ? (useScaleFor(ref) ?? null) : ref;
			},
			figure: q.figure,
			period: q.period,
			figures: catalog,
			filtersLine: () => filtersLine,
			filters: q.filters,
			noticesDay: () => noticesDay,
			townshipLine: (props) => townshipOf(props)?.text ?? null,
			onshow: (refKey) => made?.pin(refKey),
			onzoom: (item) => current.easeTo({ center: item.lngLat, minZoom: z })
		});
		// map-sdk shows the interactive card for the pinned or keyboard-focused feature and a
		// non-interactive tooltip on hover, which gets the static form.
		const tooltip = (item: FeatureListItem, props: UseProps) =>
			cards(
				item,
				props,
				current.focusedKey === item.refKey || current.pinned?.hit.refKey === item.refKey
			);
		const legendUnits = m.map_use_units_township({ units: unitsOf });
		const sectionUnits = m.map_use_units_section({ units: unitsOf });
		const parents = shapesPlugin({
			id: "townships",
			source: townships,
			layerLabel,
			mode: "choropleth",
			noFigure: "outline",
			legendDisplay: "blocks",
			zoomRange: { max: z },
			legendUnits,
			legendNote,
			tooltip,
			tooltipShowsName: true
		});
		made = shapesLens({
			id: "lens",
			parents,
			source: lensSource,
			block,
			parentOf,
			layerLabel,
			noFigure: "outline",
			legendDisplay: "blocks",
			legendUnits: sectionUnits,
			tooltip,
			tooltipShowsName: true
		});
		const children = shapesPlugin({
			id: "sections",
			source: sections,
			layerLabel,
			mode: "choropleth",
			noFigure: "outline",
			legendDisplay: "blocks",
			zoomRange: { min: z },
			selectable: false,
			legendUnits: sectionUnits,
			legendNote,
			tooltip,
			tooltipShowsName: true
		});
		const lensPlugin = made;
		const plugins = [parents, lensPlugin, children];
		untrack(() => {
			// In list order, each at its place among the layers under the focus area.
			for (const plugin of plugins) current.addPlugin(plugin, beforeIn(current, plugin.id));
			lens = lensPlugin;
		});
		return () => {
			for (const plugin of plugins) current.removePlugin(plugin.id);
			untrack(() => {
				if (lens === lensPlugin) lens = null;
			});
		};
	});

	// The lens's center goes back to the data, which loads its block's sections.
	$effect(() => {
		const center = lens?.center ?? null;
		untrack(() => onlens(center));
	});
</script>

{#snippet cardActions(ctx: CardContext)}
	{@const props = byRef.get(ctx.refKey)}
	{@const line = props ? townshipOf(props) : null}
	{#if line?.listed}
		<!-- Pinned synchronously in the handler, so map-sdk moves focus to the township's card. -->
		<button
			type="button"
			class="border-border hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring rounded-sm border px-2 py-1 text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
			onclick={() => map.pin("townships", line.refKey)}
		>
			{line.text}
		</button>
	{:else if line}
		<p class="text-sm">{line.text}</p>
	{/if}
{/snippet}
