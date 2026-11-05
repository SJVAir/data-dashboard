import type { AdapterContext } from "./adapters/registry";
import { layerTarget, splitRegionKey } from "./adapters/targets";
import { untilAborted } from "./metadata";
import type { QueryClient, Subscription } from "./query/client";
import type { QueryInput, QueryState } from "./types";

export type PlaceRegion = (
	input: QueryInput,
	signal?: AbortSignal
) => Promise<{ type: string; code: string } | null>;

/** The query's first settled state (ready, failed, or unavailable), through `client`. */
function settled(client: QueryClient, input: QueryInput, signal?: AbortSignal) {
	signal?.throwIfAborted();
	let sub: Subscription | undefined;
	const state = new Promise<QueryState>((resolve) => {
		sub = client.subscribe(input, (s) => {
			if (s.status === "ready" || s.status === "error" || s.status === "unavailable") resolve(s);
		});
	});
	sub!.setPolling(false);
	return untilAborted(state, signal).finally(() => sub!.unsubscribe());
}

/**
 * The region a point or school layer uses now: its widget's own query through `client` (so the
 * same resolution, fallback and cache as rendering), the last candidate when that query is
 * unavailable, and `null` for other places or a point or school with no region. Rejects when the
 * data can't be fetched, so a caller never falls back to the exact point silently.
 */
export function createPlaceRegion(
	client: QueryClient,
	ctx: Pick<AdapterContext, "regions" | "locations" | "points" | "metadata">
): PlaceRegion {
	return async (input, signal) => {
		const kind = input.layer.place?.kind;
		if (kind !== "location" && kind !== "point") return null;
		const target = await layerTarget(input.layer, ctx, signal);
		if ("unavailable" in target || target.kind !== "fallback") return null;
		const state = await settled(client, { ...input, timeSubRange: undefined }, signal);
		if (state.status === "error") throw state.error;
		const used = state.status === "ready" ? state.data.places[0]?.place : undefined;
		const key = used?.startsWith("region:")
			? used.slice("region:".length)
			: target.keys[target.keys.length - 1];
		return splitRegionKey(key);
	};
}
