<script lang="ts">
	let { color, label }: { color: string; label: string } = $props();
</script>

<span class="inline-flex items-center gap-2">
	<span
		data-swatch-chip
		aria-hidden="true"
		class="inline-block size-4 shrink-0 rounded-sm"
		style:background-color={color}
		style:outline-style="solid"
		style:outline-width="var(--swatch-outline-width)"
		style:outline-color="var(--swatch-outline-color)"
		style:outline-offset="calc(var(--swatch-outline-width) * -1)"
	></span>
	<span>{label}</span>
</span>
