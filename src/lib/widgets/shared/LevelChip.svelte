<script lang="ts">
	import type { Level } from "$lib/data/metadata";
	import { readableColor } from "$lib/color";

	let { level, size = "md" }: { level: Level; size?: "sm" | "md" } = $props();
</script>

<!-- The label always shows: the color is never the only carrier of the level. -->
<span
	data-level-chip
	class={[
		"inline-flex items-center rounded-(--radius-control) font-medium",
		level.color ? "" : "bg-muted text-foreground",
		size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm"
	]}
	style:background-color={level.color}
	style:color={level.color ? readableColor(level.color) : undefined}
	style:outline-style="solid"
	style:outline-width="var(--swatch-outline-width)"
	style:outline-color="var(--swatch-outline-color)"
	style:outline-offset="calc(var(--swatch-outline-width) * -1)"
>
	{level.label}
</span>
