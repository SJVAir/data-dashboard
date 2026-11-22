<script lang="ts">
	import { getContext, onDestroy, untrack } from "svelte";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { canonicalJson } from "$lib/sync/merge";
	import { CurrentConditions } from "$lib/widgets/shared/current.svelte";
	import { widgetWhere } from "$lib/widgets/shared/input";
	import { ReadingClock } from "$lib/widgets/shared/reading-clock.svelte";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "$lib/widgets/shared/viewer";
	import { placeLabel } from "$lib/widgets/title";
	import { resolveThreshold } from "./levels";
	import { setMark } from "./marks.svelte";
	import type { ThresholdWatch } from "./watcher.svelte";

	let {
		widget,
		markKey,
		title,
		watch
	}: {
		/** The widget as this watch reads it (Current conditions: one pollutant, `onePollutant`). */
		widget: WidgetInstance;
		/** The watch's key: its mark, "last told" and notification tag are held under it. */
		markKey: string;
		/** The saved widget's title (not the one-pollutant reading's), for its notification. */
		title: string;
		watch: ThresholdWatch;
	} = $props();

	const viewer = getContext<PlaceViewer | undefined>(PLACE_VIEWER_KEY) ?? "owner";
	// Polling even while minimized: a minimized widget isn't on the grid, but still watches.
	const current = new CurrentConditions(() => widget, { polling: () => true });
	// Ticks each minute, so a reading that ages past "recent" loses its mark between polls.
	const clock = new ReadingClock(() => current.reading);
	const threshold = $derived(resolveThreshold(widget.thresholds, current.levels)?.level ?? null);

	// Gone (removed, or its threshold turned Off): a crossing decided after this isn't told.
	let gone = false;
	onDestroy(() => {
		gone = true;
		setMark(markKey, null);
	});

	// What is watched (place, this watch's pollutant and its alert level): when it changes, "last
	// told" was about something else, so it's dropped and the next reading only seeds it. Another
	// pollutant of the same widget has its own watch, so changing it leaves this one alone.
	const watchedKey = $derived(
		canonicalJson({
			where: widgetWhere(widget.data),
			layers: widget.data.layers,
			thresholds: widget.thresholds ?? null
		})
	);
	let lastKey: string | undefined;

	$effect(() => {
		const key = watchedKey;
		const reading = current.reading;
		const limit = threshold;
		const levels = current.levels;
		const meta = current.meta;
		void clock.stale;
		untrack(() => {
			if (lastKey !== undefined && key !== lastKey) void watch.forget([markKey]);
			lastKey = key;
			watch.mark(markKey, reading, limit, levels, clock.now);
			const ok = reading?.status === "ok" ? reading : undefined;
			if (!ok?.level || !limit || !meta) return;
			void watch.process(
				markKey,
				{ level: ok.level, at: ok.watchAt ?? ok.at },
				limit,
				levels,
				() => ({
					title,
					pollutant: meta.entryType.label,
					place: placeLabel(ok.place, viewer)
				}),
				() => !gone
			);
		});
	});
</script>
