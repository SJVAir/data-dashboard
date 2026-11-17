import { untrack } from "svelte";
import type { MapContext } from "@sjvair/map-sdk";

/** Under the monitors when they're on the map, else on top. */
export function underMonitors(current: MapContext): { before?: string } {
	return untrack(() => current.plugins.some((p) => p.id === "monitors"))
		? { before: "monitors" }
		: {};
}
