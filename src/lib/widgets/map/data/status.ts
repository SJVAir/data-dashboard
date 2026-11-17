import type { DataStatus } from "@sjvair/map-sdk/data";
import type { NowState } from "$lib/data/now/client";

/**
 * A now state as map-sdk's data status. Errors are the widget's to show (its error state or
 * its notes, each with one Retry), so map-sdk never sees one: held data reads as ready.
 */
export function dataStatus(state: NowState<unknown>): DataStatus {
	return state.data === undefined && state.status !== "error"
		? { state: "loading" }
		: { state: "ready" };
}
