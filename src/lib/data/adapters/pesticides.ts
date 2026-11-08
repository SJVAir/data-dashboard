import {
	getCoverage,
	getPesticidesForPlace,
	pesticidePlaceFilterErrors,
	type PesticidesForPlaceFilters
} from "@sjvair/sdk";
import { todayPacific } from "$lib/format";
import { nextPeriodStart, periodStart, type ResolvedRange } from "$lib/format/range";
import {
	codesKnown,
	FilterGone,
	filterLabels,
	filterSummary,
	resetPesticideMeta
} from "../pesticide-meta";
import { untilAborted } from "../metadata";
import type { PesticideFilters } from "../schema";
import type { PlaceInfo, QueryData, Series, SeriesPoint } from "../types";
import { offeredLevels } from "./offered";
import type { AdapterContext, AdapterRequest, DatasetAdapter } from "./registry";
import { isNotFound, layerTarget, placeCandidates } from "./targets";

export { FilterGone, filterLabels, pesticideMeta } from "../pesticide-meta";

const DATASET = "pesticide-use";

/** The catalog's entry type id to the field the server's rows carry it in. */
const FIELDS = {
	"pounds-applied": "pounds",
	"acres-treated": "acres",
	applications: "applications"
} as const;

/** The server takes years from 1900 to 2100. */
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

type Row = { pounds: number; acres: number; applications: number };
type Coverage = { first: string; last: string } | null;

let coverage: Promise<Coverage> | undefined;

/** The dataset's first and last dates (`null` when it has no data), fetched once per session. */
function datasetCoverage(signal: AbortSignal): Promise<Coverage> {
	if (!coverage) {
		const request = getCoverage({ dataset: DATASET }).then((c) =>
			c.first && c.last ? { first: c.first, last: c.last } : null
		);
		coverage = request;
		request.catch(() => {
			if (coverage === request) coverage = undefined;
		});
	}
	return untilAborted(coverage, signal);
}

/** Forgets the remembered coverage, meta and names (for tests). */
export function resetPesticideCaches(): void {
	coverage = undefined;
	resetPesticideMeta();
}

function rangeYears(range: ResolvedRange): { first: number; last: number } {
	const clamp = (y: number) => Math.min(MAX_YEAR, Math.max(MIN_YEAR, y));
	return {
		first: clamp(Number(range.firstDate.slice(0, 4))),
		last: clamp(Number(range.lastDate.slice(0, 4)))
	};
}

/** The place endpoint's filters for a layer's saved filters and the range's Pacific years. */
export function toWire(filters: PesticideFilters, range: ResolvedRange): PesticidesForPlaceFilters {
	const { first, last } = rangeYears(range);
	return {
		...(filters.chemical !== undefined && { chemical: filters.chemical }),
		...(filters.commodity !== undefined && { commodity: filters.commodity }),
		...(filters.product !== undefined && { product: filters.product }),
		...(filters.category && { category: filters.category }),
		...(filters.iarcGroup !== undefined && {
			iarc_group: filters.iarcGroup as PesticidesForPlaceFilters["iarc_group"]
		}),
		...(filters.method !== undefined && {
			aerial_ground: filters.method as PesticidesForPlaceFilters["aerial_ground"]
		}),
		...(filters.narrow !== undefined && {
			narrow: filters.narrow as PesticidesForPlaceFilters["narrow"]
		}),
		year__gte: first,
		year__lte: last
	};
}

function point(t: number, value: number): SeriesPoint {
	return { t, mean: value, min: value, max: value, count: 1, partial: false };
}

type Response = Awaited<ReturnType<typeof getPesticidesForPlace>>;

/**
 * One point per month the range touches, inside the dataset's coverage: the server lists only
 * months with use, so a month it leaves out is 0. Outside coverage there is no point.
 */
function monthPoints(
	response: Response,
	field: keyof Row,
	range: ResolvedRange,
	covered: Coverage
): SeriesPoint[] {
	if (!covered) return [];
	const values = new Map(response.months.map((m) => [`${m.year}-${m.month}`, m[field]]));
	const points: SeriesPoint[] = [];
	for (
		let start = periodStart(range.start, "month");
		start < range.end;
		start = nextPeriodStart(start, "month")
	) {
		const day = todayPacific(start);
		if (day.slice(0, 7) < covered.first.slice(0, 7) || day.slice(0, 7) > covered.last.slice(0, 7)) {
			continue;
		}
		const value = values.get(`${Number(day.slice(0, 4))}-${Number(day.slice(5, 7))}`) ?? 0;
		points.push(point(start.getTime(), value));
	}
	return points;
}

/**
 * One point per year the range touches, inside coverage, from the server's year totals (which
 * include records with no application date, so a year can exceed the sum of its months).
 */
function yearPoints(
	response: Response,
	field: keyof Row,
	range: ResolvedRange,
	covered: Coverage
): SeriesPoint[] {
	if (!covered) return [];
	const values = new Map(response.years.map((y) => [y.year, y[field]]));
	const points: SeriesPoint[] = [];
	for (
		let start = periodStart(range.start, "year");
		start < range.end;
		start = nextPeriodStart(start, "year")
	) {
		const year = Number(todayPacific(start).slice(0, 4));
		if (year < Number(covered.first.slice(0, 4)) || year > Number(covered.last.slice(0, 4))) {
			continue;
		}
		points.push(point(start.getTime(), values.get(year) ?? 0));
	}
	return points;
}

async function fetchPesticides(
	req: AdapterRequest,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<QueryData> {
	const { target, range, resolution } = req;
	const field = FIELDS[req.entryType as keyof typeof FIELDS];
	if (!field) throw new Error(`Unknown pesticide entry type ${req.entryType}`);
	const filters = req.filters ?? {};
	const [groups, covered, summary] = await Promise.all([
		placeCandidates(target, ctx, signal),
		datasetCoverage(signal),
		filterSummary(req.filters, signal)
	]);
	const wire = toWire(filters, range);
	const build = resolution === "year" ? yearPoints : monthPoints;

	const answers = await Promise.all(
		groups.map(async (group): Promise<{ info: PlaceInfo; points: SeriesPoint[] }> => {
			for (const candidate of group) {
				try {
					const response = await getPesticidesForPlace(candidate.ref, wire, { signal });
					return { info: candidate.info, points: build(response, field, range, covered) };
				} catch (error) {
					// "No such place": no use for it (a fallback tries its next key).
					if (isNotFound(error)) continue;
					// A saved id removed since `target()` looked: surfaced as an error, not retried.
					const rejected = pesticidePlaceFilterErrors(error);
					for (const kind of ["chemical", "commodity", "product"] as const) {
						if (rejected?.[kind] === "not_found") throw new FilterGone(kind, filters[kind] ?? "");
					}
					throw error;
				}
			}
			return { info: group[group.length - 1].info, points: [] };
		})
	);
	const series: Series[] = answers.map((a) => ({ place: a.info.place, points: a.points }));
	const places = answers.map((a): PlaceInfo => {
		const info = target.kind === "fallback" ? { ...a.info, via: target.via } : a.info;
		return summary.length > 0 ? { ...info, filters: summary } : info;
	});
	return {
		series,
		places,
		resolution,
		fromRaw: false,
		processor: null,
		fetchedAt: req.now.getTime()
	};
}

/**
 * Reported agricultural pesticide use per place (DPR PUR): monthly totals from the server's
 * `months`, yearly totals from its `years` (undated records sit only in year rows), narrowed by
 * the layer's own filters. A saved chemical, commodity or product that the server no longer has,
 * or a saved code its pesticide meta no longer lists, makes the layer unavailable. The totals are sums (the catalog's `aggregate`).
 */
export const pesticidesAdapter: DatasetAdapter = {
	id: DATASET,
	async target(layer, ctx) {
		const target = await layerTarget(layer, ctx);
		if ("unavailable" in target) return target;
		if (target.kind === "all") return { unavailable: "place-unsupported" };
		if (layer.filters) {
			try {
				const [, known] = await Promise.all([
					filterLabels(layer.filters),
					codesKnown(layer.filters)
				]);
				// A category, cancer group, method or narrowing the server no longer lists.
				if (!known) return { unavailable: "filter-gone" };
			} catch (error) {
				if (error instanceof FilterGone) return { unavailable: "filter-gone" };
				// Any other failure surfaces, with Retry, when the data is fetched.
			}
		}
		return target;
	},
	offered: (base) => offeredLevels(DATASET, base),
	overlays: () => true,
	fetch: fetchPesticides
};
