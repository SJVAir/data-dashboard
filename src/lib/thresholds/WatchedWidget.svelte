<script lang="ts">
	import { getContext, onDestroy, untrack } from "svelte";
	import { widgetTitle } from "$lib/actions/widget";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { OUTSIDE_TYPE } from "$lib/widgets/outside";
	import { asPm25 } from "$lib/widgets/outside/pm25";
	import { CurrentConditions } from "$lib/widgets/shared/current.svelte";
	import { ReadingClock } from "$lib/widgets/shared/reading-clock.svelte";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "$lib/widgets/shared/viewer";
	import { placeLabel } from "$lib/widgets/title";
	import { resolveThreshold } from "./levels";
	import { setMark } from "./marks.svelte";
	import type { ThresholdWatch } from "./watcher.svelte";

	let { widget, watch }: { widget: WidgetInstance; watch: ThresholdWatch } = $props();

	const viewer = getContext<PlaceViewer | undefined>(PLACE_VIEWER_KEY) ?? "owner";
	// What the tile itself reads ("Can we go outside?" is always PM2.5).
	const read = $derived(widget.type === OUTSIDE_TYPE ? asPm25(widget) : widget);
	// Polling even while minimized: a minimized widget isn't on the grid, but still watches.
	const current = new CurrentConditions(() => read, { polling: () => true });
	// Ticks each minute, so a reading that ages past "recent" loses its mark between polls.
	const clock = new ReadingClock(() => current.reading);
	const threshold = $derived(resolveThreshold(widget.thresholds, current.levels)?.level ?? null);

	// Gone (removed, or its threshold turned Off): a crossing decided after this isn't told.
	let gone = false;
	onDestroy(() => {
		gone = true;
		setMark(widget.id, null);
	});

	// What the reading is of (place and pollutant): when it changes, "last told" was about
	// another place, so it's dropped and the new place's first reading only seeds it.
	const watchedKey = $derived(JSON.stringify(read.data.layers));
	let lastKey: string | undefined;

	$effect(() => {
		const key = watchedKey;
		const reading = current.reading;
		const limit = threshold;
		const levels = current.levels;
		const meta = current.meta;
		void clock.stale;
		untrack(() => {
			if (lastKey !== undefined && key !== lastKey) void watch.forget([widget.id]);
			lastKey = key;
			watch.mark(widget.id, reading, limit, levels, clock.now);
			const ok = reading?.status === "ok" ? reading : undefined;
			if (!ok?.level || !limit || !meta) return;
			void watch.process(
				widget.id,
				{ level: ok.level, at: ok.at },
				limit,
				levels,
				() => ({
					title: widgetTitle(widget),
					pollutant: meta.entryType.label,
					place: placeLabel(ok.place, viewer)
				}),
				() => !gone
			);
		});
	});
</script>
