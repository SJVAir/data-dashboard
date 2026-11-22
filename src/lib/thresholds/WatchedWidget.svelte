<script lang="ts">
	import { getContext, onDestroy, untrack } from "svelte";
	import { widgetTitle } from "$lib/actions/widget";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { canonicalJson } from "$lib/sync/merge";
	import { watchedMarkKey } from "$lib/widgets/current/pollutants";
	import { CurrentConditions } from "$lib/widgets/shared/current.svelte";
	import { widgetWhere } from "$lib/widgets/shared/input";
	import { ReadingClock } from "$lib/widgets/shared/reading-clock.svelte";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "$lib/widgets/shared/viewer";
	import { placeLabel } from "$lib/widgets/title";
	import { resolveThreshold } from "./levels";
	import { setMark } from "./marks.svelte";
	import type { ThresholdWatch } from "./watcher.svelte";

	let { widget, watch }: { widget: WidgetInstance; watch: ThresholdWatch } = $props();

	const viewer = getContext<PlaceViewer | undefined>(PLACE_VIEWER_KEY) ?? "owner";
	const read = $derived(widget);
	// Polling even while minimized: a minimized widget isn't on the grid, but still watches.
	const current = new CurrentConditions(() => read, { polling: () => true });
	// Ticks each minute, so a reading that ages past "recent" loses its mark between polls.
	const clock = new ReadingClock(() => current.reading);
	const threshold = $derived(resolveThreshold(widget.thresholds, current.levels)?.level ?? null);

	// The key its mark is written under: Current conditions' is per pollutant (the one read).
	const markId = $derived(watchedMarkKey(widget));
	let lastMarkId: string | undefined;

	// Gone (removed, or its threshold turned Off): a crossing decided after this isn't told.
	let gone = false;
	onDestroy(() => {
		gone = true;
		setMark(markId, null);
	});

	// What the reading is of (place and pollutant): when it changes, "last told" was about
	// another place, so it's dropped and the new place's first reading only seeds it.
	const watchedKey = $derived(
		canonicalJson({ where: widgetWhere(read.data), layers: read.data.layers })
	);
	let lastKey: string | undefined;

	$effect(() => {
		const key = watchedKey;
		const reading = current.reading;
		const limit = threshold;
		const levels = current.levels;
		const meta = current.meta;
		const markAt = markId;
		void clock.stale;
		untrack(() => {
			if (lastMarkId !== undefined && markAt !== lastMarkId) setMark(lastMarkId, null);
			lastMarkId = markAt;
			if (lastKey !== undefined && key !== lastKey) void watch.forget([widget.id]);
			lastKey = key;
			watch.mark(markAt, reading, limit, levels, clock.now);
			const ok = reading?.status === "ok" ? reading : undefined;
			if (!ok?.level || !limit || !meta) return;
			void watch.process(
				widget.id,
				{ level: ok.level, at: ok.watchAt ?? ok.at },
				limit,
				levels,
				() => ({
					title: widgetTitle(widget),
					pollutant: meta.entryType.label,
					place: placeLabel(ok.place, viewer)
				}),
				() => !gone,
				markAt
			);
		});
	});
</script>
