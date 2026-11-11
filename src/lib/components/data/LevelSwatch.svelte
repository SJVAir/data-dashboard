<script lang="ts">
	/** `sm` is the compact chip for keys under a chart. */
	let {
		color,
		label,
		size = "default"
	}: { color: string; label: string; size?: "default" | "sm" } = $props();
</script>

<span class={["inline-flex items-center", size === "sm" ? "gap-1" : "gap-2"]}>
	<span
		data-swatch-chip
		aria-hidden="true"
		class={["inline-block shrink-0 rounded-sm", size === "sm" ? "size-3" : "size-4"]}
		style:background-color={color}
		style:outline-style="solid"
		style:outline-width="var(--swatch-outline-width)"
		style:outline-color="var(--swatch-outline-color)"
		style:outline-offset="calc(var(--swatch-outline-width) * -1)"
	></span>
	<span>{label}</span>
</span>
