import type { MapConfig } from "@sjvair/map-sdk";

/**
 * The config every dashboard map shares, or `null` when the build has no MapTiler key (the map
 * then shows its "Map unavailable" state). The key is read by its exact name so Vite inlines
 * only it; it is never logged.
 */
export function mapConfig(): MapConfig | null {
	const maptilerKey = import.meta.env.VITE_MAPTILER_KEY;
	if (!maptilerKey) return null;
	// TODO(map-sdk change 1): turn MapTiler telemetry and session off once the pinned map-sdk
	// has the option (expected 0.1.0-beta.7); the PR doesn't merge without it.
	return { maptilerKey, projection: "mercator", cooperativeGestures: true };
}
