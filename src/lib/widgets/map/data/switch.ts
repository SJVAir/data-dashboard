import type { NowClient, NowSource } from "$lib/data/now/client";
import type { NowQuery } from "$lib/data/now/now-query.svelte";

/**
 * Sets each query to its source, holding every wanted source while they switch, so a key one
 * query lets go and another takes up (a day stepped back to, still wanted ahead) is never
 * dropped, and its fetch in flight never aborted and asked for again.
 */
export function switchQueries<T>(
	now: NowClient,
	pairs: [NowQuery<T>, NowSource<T> | null][]
): void {
	const holds = pairs.flatMap(([, source]) => {
		if (!source) return [];
		const hold = now.subscribe(source, () => {});
		hold.setPolling(false);
		return [hold];
	});
	for (const [query, source] of pairs) query.set(source);
	for (const hold of holds) hold.unsubscribe();
}
