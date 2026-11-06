import type { Level } from "$lib/data/metadata";
import type { SeriesPoint } from "$lib/data/types";
import { nextPeriodStart } from "$lib/format/range";

/** An overlay as the Chart draws it: day points with a level key, and the scale they use. */
export type ChartOverlay = { levels: Level[]; points: SeriesPoint[] };

/** A run of consecutive days at one level: from its first day's start to its last day's end. */
export type DayRun = { level: Level; index: number; start: number; end: number; days: number };

/** Hatch tile size in CSS px. */
export const HATCH_TILE = 6;

/**
 * The hatch drawn over the i-th level's bands, as line segments in a `HATCH_TILE` tile, so a
 * level never differs from another by color alone (the key's swatches use the same hatch).
 */
const HATCHES: { name: string; lines: [number, number, number, number][] }[] = [
	{
		name: "diagonal",
		lines: [
			[0, 6, 6, 0],
			[-1, 1, 1, -1],
			[5, 7, 7, 5]
		]
	},
	{
		name: "back-diagonal",
		lines: [
			[0, 0, 6, 6],
			[-1, 5, 1, 7],
			[5, -1, 7, 1]
		]
	},
	{ name: "horizontal", lines: [[0, 3, 6, 3]] },
	{ name: "vertical", lines: [[3, 0, 3, 6]] },
	{
		name: "cross",
		lines: [
			[0, 6, 6, 0],
			[-1, 1, 1, -1],
			[5, 7, 7, 5],
			[0, 0, 6, 6],
			[-1, 5, 1, 7],
			[5, -1, 7, 1]
		]
	},
	{
		name: "plus",
		lines: [
			[1.5, 3, 4.5, 3],
			[3, 1.5, 3, 4.5]
		]
	}
];

export function hatch(index: number): (typeof HATCHES)[number] {
	return HATCHES[index % HATCHES.length];
}

/**
 * The overlay's days grouped into runs of consecutive days at the same level (points whose level
 * isn't in the scale are skipped). Days are Pacific days, so a run's end is the next day's start.
 */
export function dayRuns(overlay: ChartOverlay): DayRun[] {
	const runs: DayRun[] = [];
	const points = [...overlay.points].sort((a, b) => a.t - b.t);
	for (const p of points) {
		const index = overlay.levels.findIndex((l) => l.key === p.level);
		if (index === -1) continue;
		const end = nextPeriodStart(new Date(p.t), "day").getTime();
		const last = runs.at(-1);
		if (last && last.index === index && last.end === p.t) {
			last.end = end;
			last.days++;
		} else runs.push({ level: overlay.levels[index], index, start: p.t, end, days: 1 });
	}
	return runs;
}

/** The level of the day holding `t`, if the overlay has one. */
export function overlayLevelAt(overlay: ChartOverlay, t: number): Level | undefined {
	const run = dayRuns(overlay).find((r) => t >= r.start && t < r.end);
	return run?.level;
}

type Style = {
	opacity: number;
	hatch: string;
	text: string;
	background: string;
	font: string;
	fontSize: number;
	ratio: number;
	/** A level key: its bands draw stronger and the others fainter (the key's item is focused). */
	highlight: string | null;
	/** Daily data: a band centres on its day's point, so the dot and its band line up. */
	centred: boolean;
};

function hatchPattern(ctx: CanvasRenderingContext2D, index: number, color: string, r: number) {
	const tile = document.createElement("canvas");
	tile.width = tile.height = Math.round(HATCH_TILE * r);
	const t = tile.getContext("2d")!;
	t.scale(tile.width / HATCH_TILE, tile.height / HATCH_TILE);
	t.strokeStyle = color;
	t.lineWidth = 1;
	t.beginPath();
	for (const [x1, y1, x2, y2] of hatch(index).lines) {
		t.moveTo(x1, y1);
		t.lineTo(x2, y2);
	}
	t.stroke();
	return ctx.createPattern(tile, "repeat");
}

/**
 * Draws each overlay's day bands across its lane of the plot (`box` in device px; overlays split
 * the height evenly, the first on top): the level's color, faint, under its hatch, with the
 * level's label at the run's top left when it fits. Returns how many days it drew.
 */
export function drawDayBands(
	ctx: CanvasRenderingContext2D,
	overlays: ChartOverlay[],
	x: (t: number) => number,
	box: { left: number; top: number; width: number; height: number },
	style: Style
): number {
	if (overlays.length === 0) return 0;
	const r = style.ratio;
	const lane = box.height / overlays.length;
	let days = 0;
	const patterns = new Map<number, CanvasPattern | null>();
	const patternFor = (index: number) => {
		if (!patterns.has(index)) patterns.set(index, hatchPattern(ctx, index, style.hatch, r));
		return patterns.get(index)!;
	};
	ctx.save();
	ctx.beginPath();
	ctx.rect(box.left, box.top, box.width, box.height);
	ctx.clip();
	ctx.font = `${style.fontSize * r}px ${style.font}`;
	ctx.textBaseline = "top";
	ctx.textAlign = "left";
	overlays.forEach((overlay, o) => {
		const top = box.top + o * lane;
		for (const run of dayRuns(overlay)) {
			const shift = style.centred
				? (x(nextPeriodStart(new Date(run.start), "day").getTime()) - x(run.start)) / 2
				: 0;
			const from = x(run.start) - shift;
			const to = x(run.end) - shift;
			const dim = style.highlight !== null && style.highlight !== run.level.key;
			const strong = style.highlight === run.level.key;
			days += run.days;
			ctx.globalAlpha = style.opacity * (dim ? 0.4 : strong ? 2 : 1);
			if (run.level.color !== null) {
				ctx.fillStyle = run.level.color;
				ctx.fillRect(from, top, to - from, lane);
			}
			ctx.globalAlpha = dim ? 0.25 : strong ? 0.9 : 0.55;
			const pattern = patternFor(run.index);
			if (pattern) {
				ctx.fillStyle = pattern;
				ctx.fillRect(from, top, to - from, lane);
			}
			const pad = 3 * r;
			const width = ctx.measureText(run.level.label).width;
			if (width + 2 * pad <= to - from && style.fontSize * r + 2 * pad <= lane) {
				ctx.globalAlpha = 0.85;
				ctx.fillStyle = style.background;
				ctx.fillRect(from + pad - r, top + pad - r, width + 2 * r, style.fontSize * r + 2 * r);
				ctx.globalAlpha = 1;
				ctx.fillStyle = style.text;
				ctx.fillText(run.level.label, from + pad, top + pad);
			}
		}
	});
	ctx.restore();
	return days;
}
