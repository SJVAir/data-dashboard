import type { Level } from "$lib/data/metadata";
import { resolveThreshold } from "$lib/thresholds/levels";
import type { Threshold } from "$lib/thresholds/schema";

/** A level's horizontal line on a Chart: at the level's lower bound, labeled with its name. */
export type ThresholdLine = { value: number; color: string | null; label: string };

export function thresholdLine(level: Level): ThresholdLine {
	return { value: level.min, color: level.color, label: level.label };
}

/**
 * What a Chart draws for its saved threshold: the `line`, nothing when Off, or `missing` when the
 * saved key isn't on the scale (a Chart never falls back to a default level).
 */
export function chartThreshold(
	saved: Threshold[] | undefined,
	levels: Level[]
): { line: ThresholdLine | null; missing: boolean } {
	const resolved = resolveThreshold(saved, levels);
	if (!resolved) return { line: null, missing: false };
	if (resolved.fellBack) return { line: null, missing: true };
	return { line: thresholdLine(resolved.level), missing: false };
}

type LineStyle = {
	color: string;
	text: string;
	background: string;
	font: string;
	fontSize: number;
	ratio: number;
};

/**
 * Draws `line` at canvas row `y` across the plot (`box` in device px), with its label at the left
 * edge. `color` is the level's (or the theme's fallback), `text` the label's.
 */
export function drawThresholdLine(
	ctx: CanvasRenderingContext2D,
	line: ThresholdLine,
	y: number,
	box: { left: number; top: number; width: number; height: number },
	style: LineStyle
): void {
	if (!Number.isFinite(y) || y < box.top - 1 || y > box.top + box.height + 1) return;
	const r = style.ratio;
	ctx.save();
	ctx.setLineDash([6 * r, 4 * r]);
	// A backdrop under the level color keeps a pale level (yellow) visible on any background.
	ctx.lineWidth = 3.5 * r;
	ctx.strokeStyle = style.background;
	ctx.beginPath();
	ctx.moveTo(box.left, y);
	ctx.lineTo(box.left + box.width, y);
	ctx.stroke();
	ctx.lineWidth = 2 * r;
	ctx.strokeStyle = style.color;
	ctx.stroke();
	ctx.setLineDash([]);
	const size = style.fontSize * r;
	ctx.font = `600 ${size}px ${style.font}`;
	ctx.textAlign = "left";
	ctx.textBaseline = "bottom";
	const x = box.left + 4 * r;
	const width = ctx.measureText(line.label).width;
	// Above the line, or below it at the very top of the plot.
	const textY = y - box.top > size * 1.6 ? y - 3 * r : y + 3 * r + size * 1.2;
	ctx.globalAlpha = 0.85;
	ctx.fillStyle = style.background;
	ctx.fillRect(x - 2 * r, textY - size * 1.2, width + 4 * r, size * 1.3);
	ctx.globalAlpha = 1;
	ctx.fillStyle = style.text;
	ctx.fillText(line.label, x, textY);
	ctx.restore();
}
