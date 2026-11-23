import type { Resolution } from "./schema";

export type FetchLevel = { resolution: Resolution; downsampleFromRaw: boolean };

/**
 * How to fetch a dataset's resolution (the dataset rules pick it; see `effectiveResolution`):
 * the level itself when offered, raw readings downsampled to it when only raw is offered, else
 * `null` (the query client's `no-resolution`). There is no coarser fallback: every layer of a
 * widget is fetched at the one resolution, or not at all.
 */
export function fetchLevel(
	resolution: Resolution,
	offered: readonly Resolution[]
): FetchLevel | null {
	if (offered.includes(resolution)) return { resolution, downsampleFromRaw: false };
	if (offered.length > 0 && offered.every((level) => level === "raw")) {
		return { resolution, downsampleFromRaw: true };
	}
	return null;
}
