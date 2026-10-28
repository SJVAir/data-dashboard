<script lang="ts">
	import type { ResizeEdge } from "$lib/layout/pointer-drag";

	let {
		phone,
		shown,
		onstart
	}: {
		/** One column: only the height can change, so only the bottom handle is offered. */
		phone: boolean;
		/** Keep them shown (a resize is in progress), not only on hover or focus. */
		shown: boolean;
		onstart: (event: PointerEvent, edge: ResizeEdge) => void;
	} = $props();

	// Corners come last so they sit above the edges they overlap.
	const ALL: { edge: ResizeEdge; class: string }[] = [
		{ edge: "left", class: "inset-y-0 left-0 w-2 cursor-ew-resize" },
		{ edge: "right", class: "inset-y-0 right-0 w-2 cursor-ew-resize" },
		{ edge: "bottom", class: "inset-x-0 bottom-0 h-2 cursor-ns-resize" },
		{ edge: "bottom-left", class: "bottom-0 left-0 size-4 cursor-nesw-resize" },
		{ edge: "bottom-right", class: "right-0 bottom-0 size-4 cursor-nwse-resize" }
	];
	const handles = $derived(phone ? ALL.filter((h) => h.edge === "bottom") : ALL);

	function onpointerdown(event: PointerEvent, edge: ResizeEdge): void {
		// Not a text selection.
		event.preventDefault();
		onstart(event, edge);
	}
</script>

<!-- Pointer-only (fine pointers, on hover or focus): the keyboard resizes with Shift+arrows. -->
<div
	aria-hidden="true"
	class={[
		"pointer-events-none absolute inset-0",
		shown ? "block" : "hidden pointer-fine:group-focus-within:block pointer-fine:group-hover:block"
	]}
>
	{#each handles as h (h.edge)}
		<!-- Hidden from assistive tech on purpose: Shift+arrows on the title bar do the same. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			data-resize={h.edge}
			class="hover:bg-ring/30 pointer-events-auto absolute touch-none {h.class}"
			onpointerdown={(event) => onpointerdown(event, h.edge)}
		></div>
	{/each}
</div>
