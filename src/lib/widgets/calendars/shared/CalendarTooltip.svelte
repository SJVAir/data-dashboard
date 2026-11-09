<script lang="ts">
	import type { CalendarTip } from "./calendar-tip.svelte";

	let { tip, host }: { tip: CalendarTip; host: HTMLElement | undefined } = $props();

	let el = $state<HTMLElement>();
	let pos = $state<{ left: number; top: number } | null>(null);

	/** Gap between the cell and the tooltip, and from the widget's edges. */
	const GAP = 4;

	// Above the cell (below it when there's no room), centered on it, kept inside the widget.
	$effect(() => {
		const target = tip.current;
		if (!target || !el || !host) {
			pos = null;
			return;
		}
		const box = host.getBoundingClientRect();
		const cell = target.cell.getBoundingClientRect();
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		const center = cell.left + cell.width / 2 - box.left;
		const left = Math.max(GAP, Math.min(center - w / 2, box.width - w - GAP));
		const above = cell.top - box.top - h - GAP;
		const top = above >= 0 ? above : Math.min(cell.bottom - box.top + GAP, box.height - h);
		pos = { left: Math.max(0, left), top: Math.max(0, top) };
	});
</script>

{#if tip.current}
	<!-- What the cell's accessible name already says, for the eye: hidden from assistive tech.
	     It stays while the pointer is over it, so its text can be read (WCAG 1.4.13). -->
	<div
		bind:this={el}
		aria-hidden="true"
		data-calendar-tip
		onpointerleave={(event) => {
			// Back onto a day: the grid shows that day's tip instead.
			const to = event.relatedTarget as Element | null;
			if (!to?.closest?.("[data-date]") || !host?.contains(to)) tip.left();
		}}
		class="bg-popover text-popover-foreground border-border shadow-lifted absolute z-20 max-w-64 rounded-(--radius-control) border px-2 py-1 text-xs"
		style:left="{pos?.left ?? 0}px"
		style:top="{pos?.top ?? 0}px"
		style:visibility={pos ? "visible" : "hidden"}
	>
		{tip.current.text}
	</div>
{/if}
