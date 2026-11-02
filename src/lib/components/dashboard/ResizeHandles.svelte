<script lang="ts">
	import type { ResizeEdge } from "$lib/layout/pointer-drag";

	let {
		phone,
		shown,
		touch = false,
		onstart
	}: {
		/** One column: only the height can change, so only the bottom handle is offered. */
		phone: boolean;
		/** Keep them shown (a resize is in progress), not only on hover or focus. */
		shown: boolean;
		/** A touch selection: shown, with touch-sized (44 px) hit areas and visible grips. */
		touch?: boolean;
		onstart: (event: PointerEvent, edge: ResizeEdge) => void;
	} = $props();

	// Corners come last so they sit above the edges they overlap.
	const ALL: { edge: ResizeEdge; fine: string; touch: string; grip: string }[] = [
		{
			edge: "left",
			fine: "inset-y-0 left-0 w-2 cursor-ew-resize",
			touch: "inset-y-0 left-0 w-11",
			grip: "top-1/2 left-1 h-8 w-1.5 -translate-y-1/2"
		},
		{
			edge: "right",
			fine: "inset-y-0 right-0 w-2 cursor-ew-resize",
			touch: "inset-y-0 right-0 w-11",
			grip: "top-1/2 right-1 h-8 w-1.5 -translate-y-1/2"
		},
		{
			edge: "bottom",
			fine: "inset-x-0 bottom-0 h-2 cursor-ns-resize",
			touch: "inset-x-0 bottom-0 h-11",
			grip: "bottom-1 left-1/2 h-1.5 w-8 -translate-x-1/2"
		},
		{
			edge: "bottom-left",
			fine: "bottom-0 left-0 size-4 cursor-nesw-resize",
			touch: "bottom-0 left-0 size-11",
			grip: "bottom-1 left-1 size-3"
		},
		{
			edge: "bottom-right",
			fine: "right-0 bottom-0 size-4 cursor-nwse-resize",
			touch: "right-0 bottom-0 size-11",
			grip: "right-1 bottom-1 size-3"
		}
	];
	const handles = $derived(phone ? ALL.filter((h) => h.edge === "bottom") : ALL);

	function onpointerdown(event: PointerEvent, edge: ResizeEdge): void {
		// Not a text selection.
		event.preventDefault();
		onstart(event, edge);
	}
</script>

<!-- Pointer (fine pointers, on hover or focus) and touch selections only: the keyboard resizes
with Shift+arrows. -->
<div
	aria-hidden="true"
	class={[
		"pointer-events-none absolute inset-0",
		shown || touch
			? "block"
			: "hidden pointer-fine:group-focus-within:block pointer-fine:group-hover:block"
	]}
>
	{#each handles as h (h.edge)}
		<!-- Hidden from assistive tech on purpose: Shift+arrows on the title bar do the same. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			data-resize={h.edge}
			class={[
				"pointer-events-auto absolute touch-none",
				touch ? h.touch : ["hover:bg-ring/30", h.fine]
			]}
			onpointerdown={(event) => onpointerdown(event, h.edge)}
		>
			{#if touch}
				<span class="bg-ring absolute rounded-full {h.grip}"></span>
			{/if}
		</div>
	{/each}
</div>
