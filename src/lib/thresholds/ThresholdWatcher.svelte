<script lang="ts">
	import type { WidgetInstance } from "$lib/documents/schema";
	import type { SpaceId } from "$lib/platform/types";
	import { useApp } from "$lib/store/app.svelte";
	import { watchesThresholds } from "./watched";
	import { ThresholdWatch } from "./watcher.svelte";
	import WatchedWidget from "./WatchedWidget.svelte";

	let { docId, widgets, space }: { docId: string; widgets: WidgetInstance[]; space: SpaceId } =
		$props();

	const app = useApp();
	const watched = $derived(widgets.filter(watchesThresholds));
	const watch = new ThresholdWatch({
		platform: app.platform,
		space: () => space,
		docId: () => docId,
		watching: () => watched.map((w) => w.id)
	});
</script>

<!-- The dashboard's threshold watching: minimized widgets aren't on the grid, so it runs here. -->
{#each watched as widget (widget.id)}
	<WatchedWidget {widget} {watch} />
{/each}
<div role="status" aria-live="polite" class="sr-only" data-threshold-announcer>
	{watch.announcement}
</div>
