import type { Bounds } from "@sjvair/map-sdk";

/** Zoom at which sections (not townships) are drawn; a floor (the explorer's value). */
export const SECTION_ZOOM = 11;
/** The most sections one view should ask for at once. */
export const MAX_VIEW_SECTIONS = 2000;
/** Padding, as a fraction of the view, on each side of a fetched box. */
export const BBOX_PAD = 0.5;

const METERS_PER_MILE = 1609.34;
const TOWNSHIP_DEGREES = { lat: 0.087, lng: 0.108 };

/** The first integer zoom from SECTION_ZOOM whose view is at most MAX_VIEW_SECTIONS sq. miles. */
export function sectionZoom(widthPx: number, heightPx: number, latDeg: number): number {
	const lat = (latDeg * Math.PI) / 180;
	for (let zoom = SECTION_ZOOM; zoom < 18; zoom++) {
		const milesPerPx = (156543.03 * Math.cos(lat)) / 2 ** zoom / METERS_PER_MILE;
		if (widthPx * heightPx * milesPerPx * milesPerPx <= MAX_VIEW_SECTIONS) return zoom;
	}
	return 18;
}

/** `MDM-T12S-R19E-35` gives `MDM-T12S-R19E`. */
export function townshipOfSection(mtrs: string): string {
	return mtrs.slice(0, mtrs.lastIndexOf("-"));
}

/**
 * The townships around `id` (itself included): the 3 x 3 block, fewer at an edge. Measured
 * from the centres rather than touching bounds, so diagonal neighbours and survey offsets
 * still count; the reach is floored at a full township.
 */
export function townshipBlock(
	id: string,
	townships: ReadonlyMap<string, [number, number, number, number]>
): string[] {
	const host = townships.get(id);
	if (!host) return [];
	const reach = 1.5;
	const cx = (host[0] + host[2]) / 2;
	const cy = (host[1] + host[3]) / 2;
	const maxDx = Math.max(host[2] - host[0], TOWNSHIP_DEGREES.lng) * reach;
	const maxDy = Math.max(host[3] - host[1], TOWNSHIP_DEGREES.lat) * reach;
	const ids: string[] = [];
	for (const [other, b] of townships) {
		const ox = (b[0] + b[2]) / 2;
		const oy = (b[1] + b[3]) / 2;
		if (Math.abs(ox - cx) <= maxDx && Math.abs(oy - cy) <= maxDy) ids.push(other);
	}
	return ids;
}

/** Grow `b` by `ratio` of its own size on every side. */
export function padBounds(b: Bounds, ratio: number): Bounds {
	const dx = (b.east - b.west) * ratio;
	const dy = (b.north - b.south) * ratio;
	return { west: b.west - dx, south: b.south - dy, east: b.east + dx, north: b.north + dy };
}

export function contains(outer: Bounds, inner: Bounds): boolean {
	return (
		inner.west >= outer.west &&
		inner.south >= outer.south &&
		inner.east <= outer.east &&
		inner.north <= outer.north
	);
}

export function unionBounds(list: Bounds[]): Bounds {
	return {
		west: Math.min(...list.map((b) => b.west)),
		south: Math.min(...list.map((b) => b.south)),
		east: Math.max(...list.map((b) => b.east)),
		north: Math.max(...list.map((b) => b.north))
	};
}
