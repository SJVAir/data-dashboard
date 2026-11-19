import type { QueryData, QueryState } from "./types";

/**
 * `data` with each point that carries a figure (`SeriesPoint.figure`, read when a figure was asked
 * for) showing it as its value: `mean` is the figure, or `NaN` when it is `null` ("Not enough
 * data": the point stays, so a table can say so, but nothing plots or rates it). `min`, `max` and
 * the worst hour stay the period's own. Points without a figure are unchanged (the plain mean).
 */
export function figureValues(data: QueryData): QueryData {
	if (!data.series.some((s) => s.points.some((p) => p.figure !== undefined))) return data;
	return {
		...data,
		series: data.series.map((s) => ({
			...s,
			points: s.points.map((p) =>
				p.figure === undefined ? p : { ...p, mean: p.figure === null ? NaN : p.figure }
			)
		}))
	};
}

/** `figureValues` applied to a state's data, if it has any. */
export function figureState(state: QueryState): QueryState {
	return "data" in state && state.data
		? ({ ...state, data: figureValues(state.data) } as QueryState)
		: state;
}

/** Whether a point is a figure the server had too little data for. */
export function notEnoughData(p: { figure?: number | null }): boolean {
	return p.figure === null;
}
