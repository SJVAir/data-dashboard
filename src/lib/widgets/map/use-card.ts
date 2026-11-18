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

/** A section's township, for the section card's "In township ‹id› · ‹figure›" line. */
export type UseTownshipLine = {
	refKey: string;
	/** The township's PLSS id. */
	id: string;
	/** The shown figure's value (formatted) and units, from the loaded townships; null if unknown. */
	figure: { value: string; units: string } | null;
	/** Whether map-sdk can pin its card now (the id is then a button on the interactive card). */
	pinnable: boolean;
};

/** Stands in for the id while the message is split; never in a message's own text. */
const ID_MARK = "\u2063";

/**
 * The township line's text before and after the township's id, from one message (so a
 * translation can put the id anywhere), for the card to put the id, or its button, between.
 */
export function townshipLineParts(line: UseTownshipLine): [string, string] {
	const text = line.figure
		? m.map_use_card_in_township({ township: ID_MARK, ...line.figure })
		: m.map_use_card_in_township_no_figure({ township: ID_MARK });
	const at = text.indexOf(ID_MARK);
	return at < 0 ? [`${text} `, ""] : [text.slice(0, at), text.slice(at + ID_MARK.length)];
}
