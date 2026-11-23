<script lang="ts">
	import { untrack } from "svelte";
	import { schoolsPlugin, type MapContext } from "@sjvair/map-sdk";
	import type { LocationType, SchoolsSource } from "@sjvair/map-sdk/data";
	import { underMonitors } from "./order";

	/** One location group's plugin (schools, or child care), added while it's drawn. */
	let {
		map,
		id,
		source,
		label,
		types,
		later,
		loads
	}: {
		map: MapContext;
		/** The plugin's id: "locations-" and the group's key. */
		id: string;
		/** Every loaded site: the plugins share it, each filtering by its types. */
		source: SchoolsSource;
		/** The group's label, from the regions meta. */
		label: string;
		/** The group's ticked types: the preset's allow-list. */
		types: readonly string[];
		/**
		 * The plugin ids of the groups after this one in the meta's order: it goes just below the
		 * first on the map, so the legend lists the groups in that order. Read only when added.
		 */
		later: readonly string[];
		/** Whether the tile loads its data. */
		loads: boolean;
	} = $props();

	// Each prop through a derived: a group's new item (another group ticked, say) with the same
	// values never makes the plugin again, since a prop's getter tracks the whole item.
	/** The types as a key: a new list with the same types never makes the plugin again. */
	const typesKey = $derived(JSON.stringify(types));
	const pluginId = $derived(id);
	const layerLabel = $derived(label);
	const drawn = $derived(loads);

	// Under the monitors, over the fill and use, and among the groups in the meta's order. The
	// preset owns the badges, the count bubbles, the legend, and the card (static on hover;
	// interactive pinned or keyboard-focused). It's not selectable. The source is read through getters, so a refetch keeps the plugin (and a
	// card with focus inside) in place; only a change of label or types makes it again.
	$effect(() => {
		const current = map;
		const thisId = pluginId;
		const thisLabel = layerLabel;
		// The meta's type ids (map-sdk types the three it knows; another still filters).
		const allowed = JSON.parse(typesKey) as LocationType[];
		if (!drawn || allowed.length === 0) return;
		const plugin = untrack(() =>
			schoolsPlugin({ id: thisId, source, layerLabel: thisLabel, types: allowed })
		);
		untrack(() => {
			const next = later.find((id) => current.plugins.some((p) => p.id === id));
			current.addPlugin(plugin, next ? { before: next } : underMonitors(current));
		});
		return () => current.removePlugin(thisId);
	});
</script>
