<script lang="ts">
	import MapPin from "@lucide/svelte/icons/map-pin";
	import { getContext, untrack } from "svelte";
	import { announce } from "$lib/a11y/announcer.svelte";
	import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
	import { Button } from "$lib/components/ui/button";
	import type { Dashboard } from "$lib/documents/schema";
	import { m } from "$lib/paraglide/messages.js";
	import { barVisible } from "$lib/places/replace";
	import { loadLazy } from "$lib/safety/lazy";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "$lib/widgets/shared/viewer";

	let {
		doc,
		editable,
		inert = false
	}: {
		/** The dashboard shown: the bar is its `placeBar`, shown while a widget is at its place. */
		doc: Dashboard;
		/** Offers "Change place" (not on someone else's dashboard, or a live share link). */
		editable: boolean;
		/** While a widget is fullscreen, the rest of the dashboard is inert. */
		inert?: boolean;
	} = $props();

	const viewer = getContext<PlaceViewer | undefined>(PLACE_VIEWER_KEY) ?? "owner";

	const visible = $derived(barVisible(doc));
	/** The bar's place, compared by value: an edit elsewhere doesn't name it again. */
	const key = $derived(doc.body.placeBar ? JSON.stringify(doc.body.placeBar.place) : null);

	/** What the bar says; `null` while the place is being named (a skeleton shows). */
	let text = $state<string | null>(null);
	/** The dashboard and place `text` names: a new place on the same dashboard is announced. */
	let named: { docId: string; key: string } | null = null;

	$effect(() => {
		const k = key;
		const docId = doc.id;
		if (!visible || k === null) return;
		const place = untrack(() => doc.body.placeBar!.place);
		if (named?.key !== k) text = null;
		const controller = new AbortController();
		const { signal } = controller;
		void loadLazy(() => import("$lib/places/bar-name"))
			.then(({ placeBarText }) => placeBarText(place, viewer, signal))
			.catch(() => m.place_bar_showing_unnamed())
			.then((said) => {
				if (signal.aborted) return;
				const changed = named !== null && named.docId === docId && named.key !== k;
				text = said;
				named = { docId, key: k };
				if (changed) announce(said);
			});
		return () => controller.abort();
	});
</script>

{#if visible}
	<div
		role="region"
		aria-label={m.place_bar_label()}
		aria-busy={text === null}
		data-place-bar
		{inert}
		class="bg-muted text-foreground flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-4 py-2 text-sm"
	>
		<MapPin aria-hidden="true" class="size-4 shrink-0" />
		{#if text === null}
			<span
				aria-hidden="true"
				data-place-bar-skeleton
				class="bg-foreground/10 h-4 w-40 animate-pulse rounded-(--radius-control) motion-reduce:animate-none"
			></span>
		{:else}
			<p>{text}</p>
		{/if}
		{#if editable}
			<span aria-hidden="true">·</span>
			<Button
				variant="link"
				size="sm"
				class="h-auto px-0"
				onclick={() => openPlacePicker({ dashboardPlace: true })}
			>
				{m.place_bar_change()}
			</Button>
		{/if}
	</div>
{/if}
