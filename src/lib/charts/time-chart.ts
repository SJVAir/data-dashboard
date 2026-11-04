import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { Level } from "$lib/data/metadata";
import { formatNumber, formatTick, TIME_ZONE } from "$lib/format";
import { drawBands, valueAxisMax } from "./bands";
import { seriesShape, seriesStyle, type AlignedSeries, type SeriesStyle } from "./series";
import { drawMarkers, drawSticks, type Project } from "./sticks";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Axis and band-label type, in CSS px. */
const AXIS_FONT_SIZE = 11;
const BAND_FONT_SIZE = 10;

type Theme = {
	series: SeriesStyle[];
	muted: string;
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

export type ChartInput = {
	aligned: AlignedSeries;
	levels: Level[];
	unit: string;
	/** Draw each day's worst hour (single place only; the caller decides). */
	sticks: boolean;
};

export type ChartEvents = {
	/** The x index under the cursor, or null when it leaves. */
	onCursor(idx: number | null): void;
	/** How many worst-hour sticks the last draw drew. */
	onSticks(count: number): void;
};

/** Builds the uPlot chart in `target`; bands, sticks, and dots are drawn from hooks. */
export function createTimeChart(
	target: HTMLElement,
	input: ChartInput,
	size: { width: number; height: number },
	events: ChartEvents
): uPlot {
	const { aligned, levels, unit } = input;
	const count = aligned.places.length;
	let theme = readTheme(target, count);
	const font = getComputedStyle(target).getPropertyValue("--font-sans").trim() || "sans-serif";
	const ratio = () => uPlot.pxRatio;

	const values = aligned.points.flatMap((row) =>
		row.flatMap((p) => (p ? [p.mean, p.worstHour?.value ?? p.mean] : []))
	);
	const dataMax = values.length ? Math.max(...values) : null;
	const dataMin = values.length ? Math.min(...values) : 0;
	const yMax = valueAxisMax(levels, dataMax);
	const yMin = Math.min(0, dataMin);

	const project = (u: uPlot): Project => ({
		x: (i) => u.valToPos(aligned.xs[i], "x", true),
		y: (v) => u.valToPos(v, "y", true)
	});

	const axisFont = `${AXIS_FONT_SIZE}px ${font}`;
	const data: uPlot.AlignedData = [
		aligned.xs,
		...aligned.points.map((row) => row.map((p) => (p ? p.mean : null)))
	];

	return new uPlot(
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
				x: { time: true },
				y: { range: () => [yMin, yMax] }
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
					values: (_u, splits) => splits.map((v) => formatNumber(v))
				}
			],
			series: [
				{},
				...aligned.places.map((place, i) => ({
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
					}
				],
				draw: [
					(u) => {
						const at = project(u);
						const r = ratio();
						// No clip: the value axis always holds the data, and a dot at either end of the
						// time axis should show whole.
						const { width } = u.bbox;
						const sticks = input.sticks
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
		data,
		target
	);
}

/** Moves the chart's cursor to index `idx` (as if hovered), for keyboard stepping. */
export function cursorTo(u: uPlot, idx: number, value: number): void {
	u.setCursor({ left: u.valToPos(u.data[0][idx], "x"), top: u.valToPos(value, "y") });
}

/**
 * Resolves once every animation running on an ancestor of `el` (e.g. its widget frame's resize
 * animation) has finished; at once when none are running (and under reduced motion, where the
 * frame doesn't animate).
 */
export async function ancestorAnimationsSettled(el: Element): Promise<void> {
	const running = document.getAnimations().filter((a) => {
		const target = (a.effect as KeyframeEffect | null)?.target;
		return target instanceof Element && target !== el && target.contains(el);
	});
	await Promise.all(running.map((a) => a.finished.catch(() => {})));
}
