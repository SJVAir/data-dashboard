import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { Level } from "$lib/data/metadata";
import { formatTick, TIME_ZONE } from "$lib/format";
import { valueTickLabels } from "./axis";
import { drawBands, valueAxisMax } from "./bands";
import { drawDayBands, type ChartOverlay } from "./day-bands";
import {
	alignSeries,
	seriesShape,
	seriesStyle,
	type AlignedSeries,
	type SeriesStyle,
	type XRange
} from "./series";
import { drawBars, drawMarkers, drawSticks, type Bar, type Project } from "./sticks";
import { periodSpan, type ChartStrip } from "./strips";

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
	barOpacity: number;
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
		stickOpacity: num("--chart-stick-opacity", 0.35),
		barOpacity: num("--chart-bar-opacity", 0.5)
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
	/**
	 * Number overlays, each drawn in its own plot under the main one (in `stripTargets`); the
	 * count and each strip's `chart` and `wholePeriod` must stay the same across updates.
	 */
	strips?: ChartStrip[];
};

export type ChartInput = ChartData & {
	levels: Level[];
	unit: string;
	/** The main layer as bars or a line (the catalog's `display.chart`); a line by default. */
	mainChart?: "line" | "bar";
};

export type TimeChart = {
	u: uPlot;
	/** One plot per strip, in order. */
	strips: uPlot[];
	/** Shows new data in the same chart, with the same number of places and strips. */
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
	/** How many bars the main plot's last draw drew (0 for a line). */
	onBars?(count: number): void;
	/** How many bars strip `i`'s last draw drew (0 for a line). */
	onStripBars?(i: number, count: number): void;
};

/** A bar's share of its column; the rest is the gap between neighbors. */
const BAR_SHARE = 0.8;

/** The narrowest distance between neighboring `xs` on the canvas, or `fallback` for one. */
function columnWidth(xs: number[], toPx: (t: number) => number, fallback: number): number {
	let width = Infinity;
	for (let i = 1; i < xs.length; i++) width = Math.min(width, toPx(xs[i]) - toPx(xs[i - 1]));
	return Number.isFinite(width) && width > 0 ? width : fallback;
}

/** The value a bar starts from: `yMin` (else 0), kept inside the value axis. */
function barBase(yMin: number | null | undefined, range: [number, number]): number {
	return Math.min(Math.max(yMin ?? 0, range[0]), range[1]);
}

/** Half the narrowest step between `xs`, so the first and last bars show whole. */
function halfStep(xs: number[]): number {
	let step = Infinity;
	for (let i = 1; i < xs.length; i++) step = Math.min(step, xs[i] - xs[i - 1]);
	return Number.isFinite(step) ? step / 2 : DAY_MS / 2;
}

/** A strip's value axis: from `yMin` (bars from 0 when unset) up past its data. */
function stripRange(strip: ChartStrip): [number, number] {
	const values = strip.points.map((p) => p.mean).filter(Number.isFinite);
	const dataMin = values.length ? Math.min(...values) : 0;
	const dataMax = values.length ? Math.max(...values) : 1;
	const floor = strip.yMin ?? (strip.chart === "bar" ? 0 : null);
	const lo = floor === null ? dataMin : Math.min(floor, dataMin);
	const hi = dataMax > lo ? dataMax : lo + 1;
	const [niceLo, niceHi] = uPlot.rangeNum(lo, hi, 0.1, true) as [number, number];
	return [floor === null ? niceLo : lo, niceHi];
}

/** A strip's plotted points: gap-filled at the chart's periods, or each whole period as is. */
function stripSeries(strip: ChartStrip, range: XRange | undefined): AlignedSeries {
	const data = {
		series: [{ place: "strip", points: strip.points }],
		places: [{ place: "strip", name: strip.label }],
		resolution: strip.resolution,
		fromRaw: false,
		processor: null,
		fetchedAt: 0
	};
	return alignSeries(data, strip.wholePeriod ? undefined : range);
}

let syncCount = 0;

/** Builds the uPlot chart in `target`; bands, sticks, and dots are drawn from hooks. */
export function createTimeChart(
	target: HTMLElement,
	input: ChartInput,
	size: { width: number; height: number },
	events: ChartEvents,
	/** Where each of `input.strips` draws, in order. */
	stripTargets: HTMLElement[] = []
): TimeChart {
	const { levels, unit } = input;
	const bars = input.mainChart === "bar";
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
	// The strips' cursors follow the main plot's (and theirs move it).
	const sync = stripTargets.length > 0 ? `time-chart-${++syncCount}` : null;
	const stripPlots: uPlot[] = [];

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
				...(sync && { sync: { key: sync, scales: ["x", null] } }),
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
						const [lo, hi] =
							!r || !(r.max > r.min)
								? [dataMin, dataMax]
								: [Math.min(r.min, dataMin ?? r.min), Math.max(r.max, dataMax ?? r.max)];
						if (!bars) return [lo, hi];
						// Bars centre on their period: half a column more each side shows the ends whole.
						const pad = halfStep(current.aligned.xs);
						return [lo - pad, hi + pad];
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
					spanGaps: false,
					// Bars are drawn in the draw hook, grouped per period.
					...(bars && { paths: () => null })
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
						// Bars under the worst-hour sticks.
						const barCount = bars ? drawMainBars(u) : 0;
						const sticks = current.sticks
							? drawSticks(u.ctx, aligned.points[0], at, {
									color: theme.series[0].color,
									opacity: theme.stickOpacity,
									width: 3 * r
								})
							: 0;
						if (bars) {
							events.onBars?.(barCount);
							events.onSticks(sticks);
							return;
						}
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
						events.onBars?.(0);
					}
				],
				setCursor: [(u) => events.onCursor(u.cursor.idx ?? null)],
				setScale: [
					(u, key) => {
						if (key !== "x") return;
						const x = { min: u.scales.x.min!, max: u.scales.x.max! };
						for (const s of stripPlots) s.setScale("x", x);
					}
				]
			}
		},
		plotData(current.aligned),
		target
	);

	/** Each place's bars, side by side in its period's column; returns how many were drawn. */
	function drawMainBars(u: uPlot): number {
		const { aligned } = current;
		const r = ratio();
		const toPx = (t: number) => u.valToPos(t, "x", true);
		const group = columnWidth(aligned.xs, toPx, u.bbox.width / 4) * BAR_SHARE;
		const each = group / Math.max(aligned.places.length, 1);
		const base = u.valToPos(barBase(current.yMin, yRange), "y", true);
		let drawn = 0;
		u.ctx.save();
		u.ctx.beginPath();
		u.ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
		u.ctx.clip();
		aligned.points.forEach((row, k) => {
			const list: Bar[] = [];
			row.forEach((p, i) => {
				if (!p || !Number.isFinite(p.mean)) return;
				const x0 = toPx(aligned.xs[i]) - group / 2 + k * each;
				list.push({
					x0,
					x1: x0 + each,
					base,
					top: u.valToPos(p.mean, "y", true),
					partial: p.partial
				});
			});
			drawn += drawBars(u.ctx, list, {
				color: theme.series[k].color,
				fillOpacity: theme.barOpacity,
				dash: seriesShape(k).dash.map((d) => d * r),
				line: 1.5 * r
			});
		});
		u.ctx.restore();
		return drawn;
	}

	/** A strip's plot: the main plot's time scale, its own value axis, bars or a line. */
	function createStrip(el: HTMLElement, i: number): uPlot {
		const shape = (current.strips ?? [])[i];
		const strip = () => (current.strips ?? [])[i];
		let aligned = stripSeries(shape, current.xRange);
		let range = stripRange(shape);
		const isBar = shape.chart === "bar";
		const stripData = (a: AlignedSeries): uPlot.AlignedData => [
			a.xs,
			a.points[0].map((p) => (p && Number.isFinite(p.mean) ? p.mean : null))
		];
		const plot = new uPlot(
			{
				width: Math.max(el.clientWidth, 1),
				height: Math.max(el.clientHeight, 1),
				ms: 1,
				tzDate: (ts) => uPlot.tzDate(new Date(ts), TIME_ZONE),
				legend: { show: false },
				select: { show: false, left: 0, top: 0, width: 0, height: 0 },
				// The main plot's right edge (its time axis may pad for its last label), so the two
				// plots' areas line up.
				padding: [null, () => u.width - (u.bbox.left + u.bbox.width) / ratio(), null, null],
				cursor: {
					y: false,
					drag: { x: false, y: false, setScale: false },
					sync: { key: sync!, scales: ["x", null] },
					points: {
						show: !isBar,
						size: 8,
						width: 2,
						fill: () => theme.background,
						stroke: () => theme.muted
					}
				},
				scales: {
					x: { time: true, range: () => [u.scales.x.min!, u.scales.x.max!] },
					y: { range: () => range }
				},
				axes: [
					{ show: false },
					{
						font: axisFont,
						labelFont: axisFont,
						// The unit, as on the main plot (so both plots' areas line up).
						label: shape.unit,
						labelSize: 16,
						// A strip is short: ticks closer together than the main plot's.
						space: 20,
						stroke: () => theme.muted,
						grid: { stroke: () => theme.border, width: 1 },
						ticks: { show: false },
						values: (_u, splits, _ai, _space, incr) => valueTickLabels(splits, incr)
					}
				],
				series: [
					{},
					{
						label: shape.label,
						stroke: () => theme.muted,
						width: 2,
						points: { show: false },
						spanGaps: false,
						...(isBar && { paths: () => null })
					}
				],
				hooks: {
					draw: [
						(p) => {
							const r = ratio();
							const at: Project = {
								x: (k) => p.valToPos(aligned.xs[k], "x", true),
								y: (v) => p.valToPos(v, "y", true)
							};
							if (!isBar) {
								const average = p.bbox.width / Math.max(aligned.xs.length - 1, 1);
								drawMarkers(
									p.ctx,
									aligned.points[0],
									at,
									{
										color: theme.muted,
										background: theme.background,
										marker: "circle",
										radius: 2.5 * r,
										line: 1.5 * r
									},
									{ average, min: 6 * r }
								);
								events.onStripBars?.(i, 0);
								return;
							}
							events.onStripBars?.(i, drawStripBars(p, strip(), aligned));
						}
					]
				}
			},
			stripData(aligned),
			el
		);
		const update = () => {
			aligned = stripSeries(strip(), current.xRange);
			range = stripRange(strip());
			plot.setData(stripData(aligned));
		};
		stripUpdates.push(update);
		return plot;
	}

	/** A strip's bars, clipped to its plot; a whole-period bar spans its period. */
	function drawStripBars(p: uPlot, strip: ChartStrip, aligned: AlignedSeries): number {
		const r = ratio();
		const toPx = (t: number) => p.valToPos(t, "x", true);
		const left = p.bbox.left;
		const right = p.bbox.left + p.bbox.width;
		const width = columnWidth(aligned.xs, toPx, p.bbox.width / 4) * BAR_SHARE;
		const base = p.valToPos(barBase(strip.yMin, stripRange(strip)), "y", true);
		const list: Bar[] = [];
		aligned.points[0].forEach((pt, k) => {
			if (!pt || !Number.isFinite(pt.mean)) return;
			let x0: number;
			let x1: number;
			if (strip.wholePeriod) {
				const [start, end] = periodSpan(pt.t, strip.resolution);
				// A hairline gap between neighboring periods.
				x0 = toPx(start) + r;
				x1 = toPx(end) - r;
			} else {
				x0 = toPx(aligned.xs[k]) - width / 2;
				x1 = x0 + width;
			}
			if (x1 <= left || x0 >= right) return;
			list.push({ x0, x1, base, top: p.valToPos(pt.mean, "y", true), partial: pt.partial });
		});
		p.ctx.save();
		p.ctx.beginPath();
		p.ctx.rect(left, p.bbox.top, p.bbox.width, p.bbox.height);
		p.ctx.clip();
		const drawn = drawBars(p.ctx, list, {
			color: theme.muted,
			fillOpacity: theme.barOpacity,
			dash: [],
			line: 1.5 * r
		});
		p.ctx.restore();
		return drawn;
	}

	const stripUpdates: (() => void)[] = [];
	stripTargets.forEach((el, i) => stripPlots.push(createStrip(el, i)));

	return {
		u,
		strips: stripPlots,
		update(next) {
			current = next;
			yRange = valueRange(next, levels);
			// Applied at once (not on uPlot's next microtask), so the caller can place the cursor after.
			u.batch(() => u.setData(plotData(next.aligned)));
			for (const update of stripUpdates) update();
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
