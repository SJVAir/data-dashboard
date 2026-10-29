import type { Rect } from "$lib/documents/schema";

/**
 * The grid's measured box and spacing, in pixels (the same coordinate space as the points
 * passed in, e.g. client coordinates).
 */
export type GridMetrics = {
	left: number;
	top: number;
	width: number;
	columns: number;
	rowHeight: number;
	gap: number;
};

export function cellWidth(m: GridMetrics): number {
	return (m.width - (m.columns - 1) * m.gap) / m.columns;
}

function pitchX(m: GridMetrics): number {
	return cellWidth(m) + m.gap;
}

function pitchY(m: GridMetrics): number {
	return m.rowHeight + m.gap;
}

/** The cell under a point, clamped to the grid's columns and to row 0. */
export function cellAt(m: GridMetrics, point: { x: number; y: number }): { x: number; y: number } {
	const x = Math.floor((point.x - m.left) / pitchX(m));
	const y = Math.floor((point.y - m.top) / pitchY(m));
	return { x: Math.min(Math.max(x, 0), m.columns - 1), y: Math.max(y, 0) };
}

/** Rounds half away from zero, so a delta and its negation snap alike; never -0. */
function roundHalfAway(v: number): number {
	return Math.sign(v) * Math.round(Math.abs(v)) + 0;
}

/** A pixel delta in whole cells (rounded). */
export function snapDelta(m: GridMetrics, dx: number, dy: number): { dx: number; dy: number } {
	return { dx: roundHalfAway(dx / pitchX(m)), dy: roundHalfAway(dy / pitchY(m)) };
}

/** A cell rect's box, gaps between its cells included. */
export function rectToPixels(
	m: GridMetrics,
	r: Rect
): { left: number; top: number; width: number; height: number } {
	return {
		left: m.left + r.x * pitchX(m),
		top: m.top + r.y * pitchY(m),
		width: r.w * cellWidth(m) + (r.w - 1) * m.gap,
		height: r.h * m.rowHeight + (r.h - 1) * m.gap
	};
}
