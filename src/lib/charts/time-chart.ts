import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { Level } from "$lib/data/metadata";
import { formatTick, TIME_ZONE } from "$lib/format";
import { valueTickLabels } from "./axis";
import { drawBands, valueAxisMax } from "./bands";
import { drawDayBands, type ChartOverlay } from "./day-bands";
import {
	seriesShape,
	seriesStyle,
	type AlignedSeries,
	type SeriesStyle,
	type XRange
} from "./series";
import { drawMarkers, drawSticks, type Project } from "./sticks";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Axis and band-label type, in CSS px. */
const AXIS_FONT_SIZE = 11;
const BAND_FONT_SIZE = 10;

type Theme = {
	series: SeriesStyle[];
	muted: string;
	foreground: string;
	border: string;
	background: string;
	bandOpacity: number;
	stickOpacity: number;
};

/** Colors read from the theme tokens at `el`; read again on every draw, so a theme switch shows. */
function readTheme(el: Element, count: number): Theme {
	const css = getComputedStyle(el);
	const num = (name: string, fallback: number) => {
		const n = parseFloat(css.getPropertyValue(name));
		return Number.isFinite(n) ? n : fallback;
	};
	return {
		series: Array.from({ length: count }, (_, i) => seriesStyle(i, css)),
		muted: css.getPropertyValue("--muted-foreground").trim(),
		foreground: css.getPropertyValue("--foreground").trim(),
		border: css.getPropertyValue("--border").trim(),
		background:
			css.getPropertyValue("--card").trim() || css.getPropertyValue("--background").trim(),
		bandOpacity: num("--chart-band-opacity", 0.16),
		stickOpacity: num("--chart-stick-opacity", 0.35)
	};
}

function tickUnit(incr: number): "hour" | "day" | "month" | "year" {
	if (incr < DAY_MS) return "hour";
	if (incr < 28 * DAY_MS) return "day";
	if (incr < 365 * DAY_MS) return "month";
	return "year";
}

/** What can change without rebuilding the chart (the place count must stay the same). */
export type ChartData = {
	aligned: AlignedSeries;
	/** Draw each day's worst hour (single place only; the caller decides). */
	sticks: boolean;
	/** The time axis's extent; the data's own extent when not given. */
	xRange?: XRange;
	/** Where the value axis starts (the catalog's `y_min`); else at 0 or the lowest value. */
	yMin?: number | null;
	/** Day bands behind the line, one lane each (see `drawDayBands`). */
	overlays?: ChartOverlay[];
	/** The points are days: a day band centres on its day's dot. */
	daily?: boolean;
};

export type ChartInput = ChartData & { levels: Level[]; unit: string };

export type TimeChart = {
	u: uPlot;
	/** Shows new data in the same chart, with the same number of places. */
	update(next: ChartData): void;
	/** Draws one overlay level's day bands stronger and the rest fainter; `null` for none. */
	highlight(key: string | null): void;
};

function plotData(aligned: AlignedSeries): uPlot.AlignedData {
	return [aligned.xs, ...aligned.points.map((row) => row.map((p) => (p ? p.mean : null)))];
}

/** The value axis's extent: from `yMin` (lowered to the data if needed) or 0, up past the data. */
function valueRange(data: ChartData, levels: Level[]): [number, number] {
	const values = data.aligned.points.flatMap((row) =>
		row.flatMap((p) => (p ? [p.mean, p.worstHour?.value ?? p.mean] : []))
	);
	const dataMax = values.length ? Math.max(...values) : null;
	const dataMin = values.length ? Math.min(...values) : 0;
	return [Math.min(data.yMin ?? 0, dataMin), valueAxisMax(levels, dataMax)];
}

export type ChartEvents = {
	/** The x index under the cursor, or null when it leaves. */
	onCursor(idx: number | null): void;
	/** How many worst-hour sticks the last draw drew. */
	onSticks(count: number): void;
	/** How many overlay days the last draw drew. */
	onDayBands?(count: number): void;
};

/** Builds the uPlot chart in `target`; bands, sticks, and dots are drawn from hooks. */
export function createTimeChart(
	target: HTMLElement,
	input: ChartInput,
	size: { width: number; height: number },
	events: ChartEvents
): TimeChart {
	const { levels, unit } = input;
	let current: ChartData = input;
	let yRange = valueRange(current, levels);
	const count = current.aligned.places.length;
	let theme = readTheme(target, count);
	let highlight: string | null = null;
	const font = getComputedStyle(target).getPropertyValue("--font-sans").trim() || "sans-serif";
	const ratio = () => uPlot.pxRatio;

	const project = (u: uPlot): Project => ({
		x: (i) => u.valToPos(current.aligned.xs[i], "x", true),
		y: (v) => u.valToPos(v, "y", true)
	});

	const axisFont = `${AXIS_FONT_SIZE}px ${font}`;

	const u = new uPlot(
		{
			width: size.width,
			height: size.height,
			ms: 1,
			tzDate: (ts) => uPlot.tzDate(new Date(ts), TIME_ZONE),
			legend: { show: false },
			select: { show: false, left: 0, top: 0, width: 0, height: 0 },
			cursor: {
				y: false,
				drag: { x: false, y: false, setScale: false },
				points: {
					size: 10,
					width: 2,
					fill: () => theme.background,
					stroke: (_u, si) => theme.series[si - 1]?.color ?? theme.muted
				}
			},
			scales: {
				x: {
					time: true,
					// The whole date range, widened only if the data somehow lies outside it.
					range: (_u, dataMin, dataMax) => {
						const r = current.xRange;
						if (!r || !(r.max > r.min)) return [dataMin, dataMax];
						return [Math.min(r.min, dataMin ?? r.min), Math.max(r.max, dataMax ?? r.max)];
					}
				},
				y: { range: () => yRange }
			},
			axes: [
				{
					font: axisFont,
					stroke: () => theme.muted,
					grid: { show: false },
					ticks: { stroke: () => theme.border, width: 1, size: 4 },
					values: (_u, splits, _ai, _space, incr) =>
						splits.map((s) => formatTick(new Date(s), tickUnit(incr)))
				},
				{
					font: axisFont,
					labelFont: axisFont,
					label: unit,
					labelSize: 16,
					stroke: () => theme.muted,
					grid: { stroke: () => theme.border, width: 1 },
					ticks: { show: false },
					values: (_u, splits, _ai, _space, incr) => valueTickLabels(splits, incr)
				}
			],
			series: [
				{},
				...current.aligned.places.map((place, i) => ({
					label: place,
					stroke: () => theme.series[i].color,
					width: 2,
					dash: seriesShape(i).dash.map((d) => d * ratio()),
					points: { show: false },
					spanGaps: false
				}))
			],
			hooks: {
				drawClear: [
					(u) => {
						theme = readTheme(target, count);
						drawBands(u.ctx, levels, { min: u.scales.y.min!, max: u.scales.y.max! }, u.bbox, {
							opacity: theme.bandOpacity,
							text: theme.muted,
							font,
							fontSize: BAND_FONT_SIZE,
							ratio: ratio()
						});
						const days = drawDayBands(
							u.ctx,
							current.overlays ?? [],
							(t) => u.valToPos(t, "x", true),
							u.bbox,
							{
								opacity: theme.bandOpacity,
								hatch: theme.muted,
								text: theme.foreground,
								background: theme.background,
								font,
								fontSize: BAND_FONT_SIZE,
								ratio: ratio(),
								highlight,
								centred: current.daily === true
							}
						);
						events.onDayBands?.(days);
					}
				],
				draw: [
					(u) => {
						const at = project(u);
						const r = ratio();
						// No clip: the value axis always holds the data, and a dot at either end of the
						// time axis should show whole.
						const { width } = u.bbox;
						const { aligned } = current;
						const sticks = current.sticks
							? drawSticks(u.ctx, aligned.points[0], at, {
									color: theme.series[0].color,
									opacity: theme.stickOpacity,
									width: 3 * r
								})
							: 0;
						const average = width / Math.max(aligned.xs.length - 1, 1);
						aligned.points.forEach((row, i) =>
							drawMarkers(
								u.ctx,
								row,
								at,
								{
									color: theme.series[i].color,
									background: theme.background,
									marker: theme.series[i].marker,
									radius: 3 * r,
									line: 1.5 * r
								},
								{ average, min: 6 * r }
							)
						);
						events.onSticks(sticks);
					}
				],
				setCursor: [(u) => events.onCursor(u.cursor.idx ?? null)]
			}
		},
		plotData(current.aligned),
		target
	);

	return {
		u,
		update(next) {
			current = next;
			yRange = valueRange(next, levels);
			// Applied at once (not on uPlot's next microtask), so the caller can place the cursor after.
			u.batch(() => u.setData(plotData(next.aligned)));
		},
		highlight(key) {
			if (key === highlight) return;
			highlight = key;
			u.redraw(false);
		}
	};
}

/** Moves the chart's cursor to index `idx` (as if hovered), for keyboard stepping. */
export function cursorTo(u: uPlot, idx: number, value: number): void {
	u.setCursor({ left: u.valToPos(u.data[0][idx], "x"), top: u.valToPos(value, "y") });
}

/**
 * Resolves once every finite animation running on an ancestor of `el` (e.g. its widget frame's
 * resize animation) has finished; at once when none are running (and under reduced motion, where
 * the frame doesn't animate). Endless animations are ignored, since they never finish.
 */
export async function ancestorAnimationsSettled(el: Element): Promise<void> {
	const running = document.getAnimations().filter((a) => {
		const effect = a.effect as KeyframeEffect | null;
		const target = effect?.target;
		return (
			target instanceof Element &&
			target !== el &&
			target.contains(el) &&
			Number.isFinite(effect!.getComputedTiming().endTime)
		);
	});
	await Promise.all(running.map((a) => a.finished.catch(() => {})));
}
