<script lang="ts">
	import type { WidgetInstance } from "$lib/documents/schema";
	import { setGeneratedTitle } from "$lib/widgets/titles.svelte";

	// A test widget type's component: it sets its own generated title once loaded.
	let { widget }: { widget: WidgetInstance } = $props();

	$effect(() => setGeneratedTitle(widget.id, "Generated title"));
</script>

<p>Titled widget body</p>
