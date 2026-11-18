import type { PesticideUseClass } from "@sjvair/sdk";
import { levelFor, NO_LEVEL, type Scale, type ScaleRef } from "@sjvair/map-sdk/data";
import { formatValue } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import { PESTICIDE_USE } from "../options";

export type UseLevel = "township" | "section";

export interface UseScaleInfo {
	label: string;
	units: string;
	precision: number;
}

/** The next float64 above `x`. */
function nextUp(x: number): number {
	if (x === 0) return Number.MIN_VALUE;
	const f = new Float64Array([x]);
	const i = new BigInt64Array(f.buffer);
	i[0] += x > 0 ? 1n : -1n;
	return f[0];
}

/** The most fraction digits a label gets while telling close breaks apart. */
const MAX_LABEL_PRECISION = 6;

/**
 * The fewest fraction digits, from the figure's own precision up to `MAX_LABEL_PRECISION`, at
 * which neighbouring breaks format differently, so no two adjacent class labels read the same
 * (small breaks at precision 0 would all read "0"). When none does (equal breaks), the figure's
 * own precision. The breaks themselves are the server's, unchanged.
 */
function labelPrecision(breaks: readonly number[], precision: number): number {
	for (let p = precision; p <= Math.max(precision, MAX_LABEL_PRECISION); p++) {
		const text = breaks.map((b) => formatValue(b, p));
		if (text.every((t, i) => i === 0 || t !== text[i - 1])) return p;
	}
	return precision;
}

/**
 * A use figure's value as text, at the catalog's `precision`, with more digits (up to the label
 * maximum) where that would mislead: a value above 0 never reads "0" (zero means nothing was
 * reported), and with the `scale` it is drawn with (the shown figure), the rounded value stays in
 * its own class ("0.4" would sit in "0.2 to 0.4" for 0.41 in "0.4 to 1").
 */
export function formatUseValue(value: number, precision: number, scale?: Scale | null): string {
	const most = Math.max(precision, MAX_LABEL_PRECISION);
	const own = scale && value > 0 ? levelFor(value, scale) : null;
	const classed = own && own !== NO_LEVEL ? own : null;
	for (let p = precision; p < most; p++) {
		const rounded = Math.round(value * 10 ** p) / 10 ** p;
		if (value > 0 && rounded === 0) continue;
		if (classed && scale && levelFor(rounded, scale) !== classed) continue;
		return formatValue(value, p);
	}
	return formatValue(value, most);
}

const refs = new Map<string, ScaleRef>();
const stored = new Map<
	ScaleRef,
	{ classes: PesticideUseClass; info: UseScaleInfo; scale: Scale }
>();

/**
 * The stable ref for a use figure at a level and query. The same arguments give the same object;
 * sections and the lens share one (one legend section), townships get another.
 */
export function useScaleRef(figure: string, level: UseLevel, queryKey: string): ScaleRef {
	const entryType = `${figure}|${level}|${queryKey}`;
	let ref = refs.get(entryType);
	if (!ref) {
		ref = { dataset: PESTICIDE_USE, entryType };
		refs.set(entryType, ref);
	}
	return ref;
}

/**
 * A range scale with one level per break; 0 is no level (the outline). Colours that don't pair
 * one to one with the breaks build no levels (an empty scale), never a level with no colour.
 */
export function buildUseScale(classes: PesticideUseClass, info: UseScaleInfo): Scale {
	const { colors } = classes;
	const breaks = classes.breaks.length === colors.length ? classes.breaks : [];
	const precision = labelPrecision(breaks, info.precision);
	const fmt = (n: number) => formatValue(n, precision);
	const scale: Scale = {
		id: "",
		label: info.label,
		units: info.units,
		kind: "range",
		source: null,
		averaging_hours: null,
		daily_statistic: null,
		daily_statistic_label: null,
		levels: breaks.map((b, i) => ({
			key: `c${i + 1}`,
			label:
				i === 0
					? m.map_use_class_upto({ high: fmt(b) })
					: m.map_use_class_range({ low: fmt(breaks[i - 1]), high: fmt(b) }),
			color: colors[i],
			opacity: 1,
			tier: i + 1,
			description: "",
			guidance: "",
			min: i === 0 ? Number.MIN_VALUE : nextUp(breaks[i - 1]),
			max: i === breaks.length - 1 ? null : nextUp(b),
			value: null
		}))
	};
	return scale;
}

const sameClasses = (a: PesticideUseClass, b: PesticideUseClass) =>
	a.min === b.min &&
	a.breaks.length === b.breaks.length &&
	a.breaks.every((x, i) => x === b.breaks[i]) &&
	a.colors.length === b.colors.length &&
	a.colors.every((x, i) => x === b.colors[i]);

const sameInfo = (a: UseScaleInfo, b: UseScaleInfo) =>
	a.label === b.label && a.units === b.units && a.precision === b.precision;

/**
 * Builds and stores the scale for a ref; equal classes and info keep the stored scale object.
 * map-sdk resolves a ref's scale once, so a new scale under the same ref reaches what looks it up
 * again (the cards), not the legend already drawn; a changed query is a new ref.
 */
export function registerUseScale(
	ref: ScaleRef,
	classes: PesticideUseClass,
	info: UseScaleInfo
): void {
	const prior = stored.get(ref);
	if (prior && sameClasses(prior.classes, classes) && sameInfo(prior.info, info)) return;
	stored.set(ref, { classes, info: { ...info }, scale: buildUseScale(classes, info) });
}

export function useScaleFor(ref: ScaleRef): Scale | undefined {
	return stored.get(ref)?.scale;
}
