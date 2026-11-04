import { formatValue } from "$lib/format";

const MAX_DECIMALS = 10;

/** How many decimals `n` needs to be written exactly (ignoring floating-point noise). */
function decimalsFor(n: number): number {
	for (let d = 0; d < MAX_DECIMALS; d++) {
		const scaled = n * 10 ** d;
		if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, Math.abs(scaled))) return d;
	}
	return MAX_DECIMALS;
}

/**
 * Value-axis tick labels, all with the same number of decimals: as many as the tick increment
 * needs, and more only when that's what keeps the labels distinct.
 */
export function valueTickLabels(splits: number[], incr: number): string[] {
	for (let d = decimalsFor(incr); ; d++) {
		const labels = splits.map((v) => formatValue(v, d));
		if (new Set(labels).size === labels.length || d >= MAX_DECIMALS) return labels;
	}
}
