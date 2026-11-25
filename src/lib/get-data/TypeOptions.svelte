<script lang="ts">
	import type { Snippet } from "svelte";

	/** A type's own settings: always open, under Show as. */
	let { label, children }: { label: string; children: Snippet } = $props();
	const id = $props.id();
</script>

<section class="flex flex-col gap-2" aria-labelledby={id}>
	<h2 {id} class="text-primary text-sm font-semibold">{label}</h2>
	{@render children()}
</section>
