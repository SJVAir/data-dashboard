<script lang="ts">
	import { untrack } from "svelte";
	import { widgetTitle } from "$lib/actions/widget";
	import type { WidgetInstance } from "$lib/documents/schema";
	import type { SpaceId } from "$lib/platform/types";
	import { useApp } from "$lib/store/app.svelte";
	import { watchesOf, watchesThresholds } from "./watched";
	import { ThresholdWatch } from "./watcher.svelte";
	import WatchedWidget from "./WatchedWidget.svelte";

	let { docId, widgets, space }: { docId: string; widgets: WidgetInstance[]; space: SpaceId } =
		$props();

	const app = useApp();
	// One watch per watched widget and pollutant (Current conditions'), each under its `markKey`.
	const watches = $derived(
		widgets
			.filter(watchesThresholds)
			.flatMap((w) => watchesOf(w).map((one) => ({ ...one, title: widgetTitle(w) })))
	);
	const watch = new ThresholdWatch({
		platform: app.platform,
		space: () => space,
		docId: () => docId,
		watching: () => watches.map((w) => w.key)
	});

	// A watch that ends (its widget removed, its alert level switched Off) loses its "last told"
	// at once, so turning it back on (or undoing) starts from its next reading, not a stale entry.
	let previous: string[] = [];
	$effect(() => {
		const ids = watches.map((w) => w.key);
		untrack(() => {
			const gone = previous.filter((id) => !ids.includes(id));
			previous = ids;
			if (gone.length) void watch.forget(gone);
		});
	});
</script>

<!-- The dashboard's threshold watching: minimized widgets aren't on the grid, so it runs here. -->
{#each watches as { key, widget, title } (key)}
	<WatchedWidget {widget} markKey={key} {title} {watch} />
{/each}
<div role="status" aria-live="polite" class="sr-only" data-threshold-announcer>
	{watch.announcement}
</div>
