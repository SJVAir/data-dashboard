<script lang="ts">
	import { untrack, type Snippet } from "svelte";
	import { shapesLens, shapesPlugin, type MapContext, type ShapesLens } from "@sjvair/map-sdk";
	import type { DataSource } from "@sjvair/map-sdk/data";
	import { m } from "$lib/paraglide/messages.js";
	import type { UseProps } from "../data/use";
	import { beforeIn } from "./order";

	/**
	 * Pesticide use's three plugins, `[townships, lens, sections]`, above the fill and under the
	 * focus area (`UNDER_FOCUS`), added while use is drawn; renders nothing. The townships draw below the section
	 * zoom and the sections from it; the lens opens a township's block into sections on hover.
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
		drawn,
		loads,
		note,
		onlens,
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
		/** Whether use is on the map. */
		drawn: boolean;
		/** Whether the tile loads its data. */
		loads: boolean;
		/** The legend section's note. */
		note: Snippet;
		/** The township the lens is centred on (null when it drops, or with no lens). */
		onlens: (center: string | null) => void;
		/** The lens plugin while it's on the map (the township card pins and releases it). */
		lens?: ShapesLens | null;
	} = $props();

	// Made again only when the zoom, the figure or the query changes: a plugin belongs to one map
	// and one set of options.
	$effect(() => {
		const current = map;
		const layerLabel = label;
		const z = zoom;
		const legendNote = note;
		const unitsOf = units;
		void queryKey;
		if (!layerLabel || !loads || !drawn) return;
		const legendUnits = m.map_use_units_township({ units: unitsOf });
		const sectionUnits = m.map_use_units_section({ units: unitsOf });
		const parents = shapesPlugin({
			id: "townships",
			source: townships,
			layerLabel,
			mode: "choropleth",
			noFigure: "outline",
			zoomRange: { max: z },
			legendUnits,
			legendNote
		});
		const made = shapesLens({
			id: "lens",
			parents,
			source: lensSource,
			block,
			parentOf,
			layerLabel,
			noFigure: "outline",
			legendUnits: sectionUnits
		});
		const children = shapesPlugin({
			id: "sections",
			source: sections,
			layerLabel,
			mode: "choropleth",
			noFigure: "outline",
			zoomRange: { min: z },
			selectable: false,
			legendUnits: sectionUnits,
			legendNote
		});
		const plugins = [parents, made, children];
		untrack(() => {
			// In list order, each at its place among the layers under the focus area.
			for (const plugin of plugins) current.addPlugin(plugin, beforeIn(current, plugin.id));
			lens = made;
		});
		return () => {
			for (const plugin of plugins) current.removePlugin(plugin.id);
			untrack(() => {
				if (lens === made) lens = null;
			});
		};
	});

	// The lens's center goes back to the data, which loads its block's sections.
	$effect(() => {
		const center = lens?.center ?? null;
		untrack(() => onlens(center));
	});
</script>
