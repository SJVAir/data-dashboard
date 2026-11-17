import { levelFor, NO_LEVEL, type Scale } from "@sjvair/map-sdk/data";
import { m } from "$lib/paraglide/messages.js";
import type { UseScaleInfo } from "./data/use-scale";

/** A catalog pesticide-use figure the map draws: its entry type id, label, units and precision. */
export type UseFigure = UseScaleInfo & { id: string };

/** The month with the most use (1–12), the first on a tie; null when every month is zero. */
export function peakMonth(months: { month: number; value: number }[]): number | null {
	let peak: { month: number; value: number } | null = null;
	for (const row of months) if (row.value > (peak?.value ?? 0)) peak = row;
	return peak?.month ?? null;
}

/**
 * A value's class on the use scale, in words: its tier, how many classes there are, and the
 * class's range label. Null for zero (no data) or a value the scale has no class for.
 */
export function classInWords(
	scale: Scale,
	value: number
): { tier: number; count: number; label: string } | null {
	if (value <= 0) return null;
	const level = levelFor(value, scale);
	if (level === NO_LEVEL || !level || level.tier === null) return null;
	return { tier: level.tier, count: scale.levels.length, label: level.label };
}

/**
 * A section's top chemicals: the first three by pounds. The section response ranks and weighs
 * them by pounds only, so the card can't rank them by acres or applications.
 */
export function topChemicals<T extends { lbs: number }>(chemicals: T[]): T[] {
	return chemicals.toSorted((a, b) => b.lbs - a.lbs).slice(0, 3);
}

/** The active filters' names joined for one line ("Sulfur · Grapes"); null with none. */
export function joinLabels(labels: string[]): string | null {
	return labels.length === 0
		? null
		: labels.reduce((all, label) => m.label_join({ first: all, second: label }));
}
