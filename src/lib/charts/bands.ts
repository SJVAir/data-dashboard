import { levelFor, type Level } from "$lib/data/metadata";

export type BandBox = { level: Level; top: number; bottom: number; label: string[] | null };

/** Space kept above and below a band label, in px. */
export const BAND_LABEL_PADDING = 3;

/**
 * The label's words greedily wrapped into lines no wider than `width`, or null when that takes
 * more than `maxLines` lines or a single word is too wide. Never shortens a word.
 */
function wrap(text: string, measure: (t: string) => number, width: number, maxLines: number) {
	const lines: string[] = [];
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const last = lines.at(-1);
		if (last !== undefined && measure(`${last} ${word}`) <= width) {
			lines[lines.length - 1] = `${last} ${word}`;
		} else {
			if (measure(word) > width) return null;
			lines.push(word);
		}
	}
	return lines.length > 0 && lines.length <= maxLines ? lines : null;
}

/** Band rectangles (in px) for a value scale, with the label wrapped into ≤ 2 lines that fit
 *  `width`, or null when the band is too thin or the label doesn't fit. */
export function layoutBands(
	levels: Level[],
	scale: { min: number; max: number; height: number },
	measure: (text: string) => number,
	width: number,
	lineHeight: number
): BandBox[] {
	const span = scale.max - scale.min;
	if (!(span > 0)) return [];
	const px = (v: number) => scale.height - ((v - scale.min) / span) * scale.height;
	const boxes: BandBox[] = [];
	for (const level of levels) {
		const lo = Math.max(level.min, scale.min);
		const hi = Math.min(level.max ?? scale.max, scale.max);
		if (hi <= lo) continue;
		const top = px(hi);
		const bottom = px(lo);
		const room = Math.floor((bottom - top - 2 * BAND_LABEL_PADDING) / lineHeight + 1e-9);
		const label = room >= 1 ? wrap(level.label, measure, width, Math.min(room, 2)) : null;
		boxes.push({ level, top, bottom, label });
	}
	return boxes;
}

/**
 * The value axis's top: the larger of the data's max (worst hours included) and the top of the
 * level that holds it, so the band the data reaches shows whole. With no data, the first
 * level's top.
 */
export function valueAxisMax(levels: Level[], dataMax: number | null): number {
	if (dataMax === null) return levels.find((l) => l.max !== null)?.max ?? 1;
	const top = levelFor(levels, dataMax)?.max ?? null;
	return Math.max(dataMax, top ?? dataMax) || 1;
}

/**
 * Fills each band across the plot (`box` in device px) and writes its label at the right edge.
 * `ratio` is device px per CSS px; `layoutBands` works in CSS px.
 */
export function drawBands(
	ctx: CanvasRenderingContext2D,
	levels: Level[],
	scale: { min: number; max: number },
	box: { left: number; top: number; width: number; height: number },
	style: { opacity: number; text: string; font: string; fontSize: number; ratio: number }
): void {
	const r = style.ratio;
	const lineHeight = Math.round(style.fontSize * 1.2);
	ctx.save();
	ctx.font = `${style.fontSize * r}px ${style.font}`;
	const measure = (t: string) => ctx.measureText(t).width / r;
	const labelWidth = Math.min(box.width / r / 2, 160);
	const boxes = layoutBands(
		levels,
		{ ...scale, height: box.height / r },
		measure,
		labelWidth,
		lineHeight
	);
	for (const band of boxes) {
		if (band.level.color === null) continue;
		// The server's opacity is a map fill's (e.g. 0.4); capped so bands stay faint behind the line.
		ctx.globalAlpha = Math.min(band.level.opacity ?? style.opacity, style.opacity);
		ctx.fillStyle = band.level.color;
		ctx.fillRect(box.left, box.top + band.top * r, box.width, (band.bottom - band.top) * r);
	}
	ctx.globalAlpha = 1;
	ctx.fillStyle = style.text;
	ctx.textAlign = "right";
	ctx.textBaseline = "top";
	const right = box.left + box.width - 4 * r;
	for (const band of boxes) {
		band.label?.forEach((line, i) => {
			const y = band.top + BAND_LABEL_PADDING + i * lineHeight + (lineHeight - style.fontSize) / 2;
			ctx.fillText(line, right, box.top + y * r);
		});
	}
	ctx.restore();
}
