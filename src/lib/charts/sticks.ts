import type { SeriesPoint } from "$lib/data/types";
import type { Marker } from "./series";

/** Where a mark goes on the canvas (device px): x for an index, y for a value. */
export type Project = { x: (i: number) => number; y: (v: number) => number };

/**
 * Each day's worst hour as a light stick from the dot up to the worst hourly value. Returns how
 * many sticks were drawn.
 */
export function drawSticks(
	ctx: CanvasRenderingContext2D,
	points: (SeriesPoint | null)[],
	at: Project,
	style: { color: string; opacity: number; width: number }
): number {
	let drawn = 0;
	ctx.save();
	ctx.strokeStyle = style.color;
	ctx.globalAlpha = style.opacity;
	ctx.lineWidth = style.width;
	ctx.lineCap = "round";
	ctx.setLineDash([]);
	points.forEach((p, i) => {
		if (!p?.worstHour) return;
		drawn++;
		if (p.worstHour.value <= p.mean) return;
		ctx.beginPath();
		ctx.moveTo(at.x(i), at.y(p.mean));
		ctx.lineTo(at.x(i), at.y(p.worstHour.value));
		ctx.stroke();
	});
	ctx.restore();
	return drawn;
}

function shape(ctx: CanvasRenderingContext2D, marker: Marker, x: number, y: number, r: number) {
	ctx.beginPath();
	switch (marker) {
		case "circle":
			ctx.arc(x, y, r, 0, Math.PI * 2);
			break;
		case "square":
			ctx.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
			break;
		case "triangle":
			ctx.moveTo(x, y - r * 1.2);
			ctx.lineTo(x + r * 1.1, y + r * 0.8);
			ctx.lineTo(x - r * 1.1, y + r * 0.8);
			ctx.closePath();
			break;
		case "diamond":
			ctx.moveTo(x, y - r * 1.25);
			ctx.lineTo(x + r * 1.25, y);
			ctx.lineTo(x, y + r * 1.25);
			ctx.lineTo(x - r * 1.25, y);
			ctx.closePath();
			break;
		case "cross":
			ctx.moveTo(x - r, y - r);
			ctx.lineTo(x + r, y + r);
			ctx.moveTo(x + r, y - r);
			ctx.lineTo(x - r, y + r);
			break;
	}
}

/**
 * The dots at each point, in the series' marker shape; a partial period's dot is hollow. When
 * points are too close together (under `minSpacing` device px apart on average) only isolated
 * points (no neighbor to draw a line to) and partial ones get a dot.
 */
export function drawMarkers(
	ctx: CanvasRenderingContext2D,
	points: (SeriesPoint | null)[],
	at: Project,
	style: { color: string; background: string; marker: Marker; radius: number; line: number },
	spacing: { average: number; min: number }
): void {
	const dense = spacing.average < spacing.min;
	ctx.save();
	ctx.setLineDash([]);
	ctx.lineWidth = style.line;
	points.forEach((p, i) => {
		if (!p) return;
		const isolated = !points[i - 1] && !points[i + 1];
		if (dense && !isolated && !p.partial) return;
		shape(ctx, style.marker, at.x(i), at.y(p.mean), style.radius);
		const hollow = p.partial || style.marker === "cross";
		ctx.fillStyle = hollow ? style.background : style.color;
		ctx.strokeStyle = style.color;
		if (style.marker !== "cross") ctx.fill();
		ctx.stroke();
	});
	ctx.restore();
}
