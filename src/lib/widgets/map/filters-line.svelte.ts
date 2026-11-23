import { untrack } from "svelte";
import { filterSummary } from "$lib/data/pesticide-meta";
import type { PesticideFilters } from "$lib/data/schema";
import { filtersKey } from "./data/filters-key";
import { joinLabels } from "./use-card";

/** The last names per filters key, kept across a remount (a new plugin draws the line again). */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a cache read at start, not state
const lastNamed = new Map<string, string | null>();

/** Forgets the kept names (for tests). */
export function resetFiltersLines(): void {
	lastNamed.clear();
}

/**
 * The use layer's active filters, named as charts' legends name them and joined ("Sulfur ·
 * Grapes"), for the use legend and cards; null with no filters, or when the names can't be had
 * (a gone filter is the map's own note). The last names for an equal set show at once, and stay
 * until the new ones are ready (no flicker). Call while a component initialises.
 */
export function filtersLine(filters: () => PesticideFilters | undefined): {
	readonly current: string | null;
} {
	/** The filters as a key, so an equal set saved again asks for nothing. */
	const key = $derived(filtersKey(filters() ?? {}));
	let named = $state.raw<string | null>(untrack(() => lastNamed.get(key) ?? null));
	$effect(() => {
		const current = key;
		if (lastNamed.has(current)) named = lastNamed.get(current) ?? null;
		const controller = new AbortController();
		filterSummary(JSON.parse(current) as PesticideFilters, controller.signal).then(
			(labels) => {
				const joined = joinLabels(labels);
				lastNamed.set(current, joined);
				named = joined;
			},
			() => {
				if (!controller.signal.aborted) named = null;
			}
		);
		return () => controller.abort();
	});
	return {
		get current() {
			return named;
		}
	};
}
