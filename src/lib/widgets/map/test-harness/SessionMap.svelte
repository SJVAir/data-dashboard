<script lang="ts">
	import { useApp } from "$lib/store/app.svelte";
	import MapWidget from "../MapWidget.svelte";

	/** The Map in the current session's document, re-rendered as the document changes. */
	let { widgetId }: { widgetId: string } = $props();
	const app = useApp();
	const widget = $derived(app.current.session?.doc.body.widgets.find((w) => w.id === widgetId));
</script>

{#if widget}
	<MapWidget {widget} />
{/if}
