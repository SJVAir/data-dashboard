import type { PesticideUseClass } from "@sjvair/sdk";
import type { Scale, ScaleRef } from "@sjvair/map-sdk/data";
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

const refs = new Map<string, ScaleRef>();
const stored = new Map<ScaleRef, { classes: PesticideUseClass; scale: Scale }>();

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
	const fmt = (n: number) => formatValue(n, info.precision);
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

/** Builds and stores the scale for a ref; equal classes keep the stored scale object. */
export function registerUseScale(
	ref: ScaleRef,
	classes: PesticideUseClass,
	info: UseScaleInfo
): void {
	const prior = stored.get(ref);
	if (prior && sameClasses(prior.classes, classes)) return;
	stored.set(ref, { classes, scale: buildUseScale(classes, info) });
}

export function useScaleFor(ref: ScaleRef): Scale | undefined {
	return stored.get(ref)?.scale;
}
