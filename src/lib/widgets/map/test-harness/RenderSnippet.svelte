<script lang="ts">
	import type { Snippet } from "svelte";

	// Renders a plugin's tooltip snippet, as map-sdk's card does.
	let { snippet }: { snippet: Snippet } = $props();
</script>

{@render snippet()}
