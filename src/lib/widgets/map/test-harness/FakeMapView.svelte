<script lang="ts">
	import type { Snippet } from "svelte";
	import type { CardContext } from "@sjvair/map-sdk";
	import { decodeRef, selectionKeys } from "@sjvair/map-sdk/data";
	import { fakeMaps, type FakeMap } from "./fake-map.svelte";

	let {
		map,
		active = true,
		label,
		overlays,
		featureList,
		selectionBar,
		tooltip,
		card = false,
		class: className
	}: {
		map: FakeMap;
		active?: boolean;
		label?: string;
		overlays?: Snippet;
		featureList?: unknown;
		selectionBar?: boolean;
		tooltip?: string;
		card?: boolean | { actions?: Snippet<[CardContext]> };
		class?: string;
	} = $props();

	$effect(() => {
		map.view = { active, label, featureList, selectionBar, tooltip, card };
	});

	// Like MapView making its GL map where there's no WebGL.
	$effect(() => {
		if (active && fakeMaps.failView) {
			fakeMaps.failView = false;
			throw new Error("Failed to initialize WebGL");
		}
	});

	const actions = $derived(typeof card === "object" ? card.actions : undefined);
	/** The pinned card's context, as map-sdk builds it (`selectable`, `selected`, `toggle`). */
	const cardContext = $derived.by<CardContext | null>(() => {
		const hit = map.pinned?.hit;
		const ref = hit ? decodeRef(hit.refKey) : null;
		if (!hit || !ref) return null;
		const { pluginId, refKey } = hit;
		return {
			pluginId,
			ref,
			refKey,
			item: null,
			get selectable() {
				return map.getSelectionMode(pluginId) !== "none" && ref.kind !== "feature";
			},
			get selected() {
				return selectionKeys(map.getSelection(pluginId)).has(refKey);
			},
			toggle: () => map.togglePick(pluginId, ref)
		};
	});
</script>

<!-- Like map-sdk with `card`: a click on the map pins the monitor under it (and never selects). -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div
	class={className}
	role="region"
	aria-label={label ?? "Map"}
	data-fake-map={map.uid}
	data-active={active}
	onclick={() => {
		if (card) map.pinned = { hit: { pluginId: "monitors", refKey: "monitor:a", name: "a" } };
	}}
>
	{@render overlays?.()}
</div>
{#if cardContext && actions}
	<!-- Over the map, as map-sdk pins it. -->
	<div class="absolute top-0 right-0 z-10" data-fake-card={cardContext.refKey}>
		{@render actions(cardContext)}
	</div>
{/if}
{#if map.notice}
	<p data-fake-notice>{map.notice.message}</p>
{/if}
