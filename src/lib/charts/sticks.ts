import type { SeriesPoint } from "$lib/data/types";
import type { Marker } from "./series";

/** Where a mark goes on the canvas (device px): x for an index, y for a value. */
export type Project = { x: (i: number) => number; y: (v: number) => number };

/**
 * Each day's worst hour as a light stick from the dot up to the worst hourly value. Returns how
 * many sticks were drawn (a worst hour no higher than the average has none).
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
		if (p.worstHour.value <= p.mean) return;
		drawn++;
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

/** One bar on the canvas (device px): from `x0` to `x1`, from the `base` line up to `top`. */
export type Bar = { x0: number; x1: number; base: number; top: number; partial: boolean };

/**
 * Bars filled lightly with an outline in `color` (dashed for a place's dash pattern); a partial
 * period's bar is hollow, as a partial dot is. Returns how many bars were drawn.
 */
export function drawBars(
	ctx: CanvasRenderingContext2D,
	bars: Bar[],
	style: { color: string; fillOpacity: number; dash: number[]; line: number }
): number {
	ctx.save();
	ctx.strokeStyle = style.color;
	ctx.fillStyle = style.color;
	ctx.lineWidth = style.line;
	ctx.setLineDash(style.dash);
	for (const bar of bars) {
		const x = Math.min(bar.x0, bar.x1);
		const w = Math.max(Math.abs(bar.x1 - bar.x0), 1);
		const y = Math.min(bar.base, bar.top);
		const h = Math.abs(bar.base - bar.top);
		if (!bar.partial) {
			ctx.globalAlpha = style.fillOpacity;
			ctx.fillRect(x, y, w, h);
		}
		ctx.globalAlpha = 1;
		ctx.beginPath();
		// A zero bar is a flat mark on its base line.
		if (h < style.line) {
			ctx.moveTo(x, bar.base);
			ctx.lineTo(x + w, bar.base);
		} else {
			ctx.rect(x, y, w, h);
		}
		ctx.stroke();
	}
	ctx.restore();
	return bars.length;
}
