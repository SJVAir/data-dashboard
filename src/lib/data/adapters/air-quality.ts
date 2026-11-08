import { periodStart, type Period } from "$lib/format/range";
import { aggregate } from "../aggregate";
import { runLimited } from "../chunks";
import { downsampleInWorker } from "../downsample-client";
import { finerLevel, planSegments, type Segment } from "../periods";
import { worstHours } from "../worst-hour";
import type { PlaceInfo, QueryData, Series, SeriesPoint, Target } from "../types";
import {
	bulkSummaryTasks,
	monitorSummaryTasks,
	rawTasks,
	type Fetched,
	type SummaryOptions,
	type FetchTask
} from "./air-quality-fetch";
import type { AdapterContext, AdapterRequest, DatasetAdapter } from "./registry";
import { layerTarget, regionPlace, resolveRegionKeys } from "./targets";

/** Requests in flight at once for one query. */
const CONCURRENCY = 3;

/** A place in the result: its series key and its server id (monitor id or region sqid). */
type Place = { place: string; id: string };

async function placesOf(
	target: Target,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<{ places: Place[]; info: PlaceInfo[] }> {
	if (target.kind === "monitors") {
		const monitors = await ctx.metadata.monitors(signal);
		const names = new Map(monitors.map((m) => [m.id, m.name]));
		return {
			places: target.ids.map((id) => ({ place: `monitor:${id}`, id })),
			info: target.ids.map((id) => ({ place: `monitor:${id}`, name: names.get(id) ?? id }))
		};
	}
	if (target.kind === "all") return { places: [], info: [] };
	const found = await resolveRegionKeys(target.keys, ctx.regions, signal);
	const places: Place[] = [];
	const info: PlaceInfo[] = [];
	target.keys.forEach((key, i) => {
		const region = found[i];
		if (region === null) throw new Error(`Region ${key} can't be looked up`);
		places.push({ place: regionPlace(key), id: region.id });
		info.push({
			place: regionPlace(key),
			name: region.name,
			...(region.retired && { retired: region.retired })
		});
	});
	return { places, info };
}

/**
 * The processor of a monitor's published series (its type's default calibration), which the
 * single-monitor endpoints need named; bulk endpoints return it by default.
 */
async function publishedProcessor(
	monitorId: string,
	entryType: string,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<string | null> {
	const type = await ctx.metadata.monitorType(monitorId, signal);
	return type === null ? null : ctx.metadata.defaultProcessor(type, entryType, signal);
}

/** Each place's processor: the published one for monitors; `null` for regions and bulk. */
function placeProcessors(
	req: AdapterRequest,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<Array<string | null>> {
	const { target } = req;
	if (target.kind !== "monitors") return Promise.resolve([]);
	return Promise.all(target.ids.map((id) => publishedProcessor(id, req.entryType, ctx, signal)));
}

/**
 * Runs every group's tasks together with limited concurrency, then collects each group's points
 * by place id, in time order.
 */
async function collect(
	groups: FetchTask[][],
	signal: AbortSignal
): Promise<Array<Map<string, SeriesPoint[]>>> {
	const tagged = groups.flatMap((tasks, group) => tasks.map((task) => ({ group, task })));
	const results: Fetched[][] = await runLimited(
		tagged.map((t) => t.task),
		CONCURRENCY,
		signal
	);
	const maps = groups.map(() => new Map<string, SeriesPoint[]>());
	results.forEach((fetched, i) => {
		const byId = maps[tagged[i].group];
		for (const { id, points } of fetched) {
			const list = byId.get(id);
			// A loop, not `push(...points)`: a month of raw entries can exceed the argument limit.
			if (list) for (const point of points) list.push(point);
			else byId.set(id, [...points]);
		}
	});
	for (const byId of maps) for (const points of byId.values()) points.sort((a, b) => a.t - b.t);
	return maps;
}

/** Raw entries of each monitor's published series over the range so far. */
function rawFetch(
	req: AdapterRequest,
	places: Place[],
	processors: Array<string | null>,
	signal: AbortSignal
) {
	const { range, now } = req;
	const end = new Date(Math.min(range.end.getTime(), now.getTime()));
	const tasks = places.flatMap((p, i) =>
		rawTasks(p.id, req.entryType, processors[i], range.start, end, signal)
	);
	return collect([tasks], signal).then(([byId]) => byId);
}

/** Raw entries as they are, or downsampled (in a worker) to the requested resolution. */
async function rawSeries(
	req: AdapterRequest,
	places: Place[],
	processors: Array<string | null>,
	signal: AbortSignal
): Promise<Series[]> {
	if (req.target.kind !== "monitors") throw new Error("Raw entries exist only for monitors");
	const byId = await rawFetch(req, places, processors, signal);
	const to = req.resolution as Period;
	const openFrom = req.downsampleFromRaw ? periodStart(req.now, to).getTime() : 0;
	return Promise.all(
		places.map(async ({ place, id }) => {
			const raw = byId.get(id) ?? [];
			if (!req.downsampleFromRaw) return { place, points: raw };
			const readings = raw.map((p) => ({ t: p.t, value: p.mean }));
			return { place, points: await downsampleInWorker(readings, to, openFrom, signal) };
		})
	);
}

/**
 * Summaries over the range: completed periods at the requested resolution, the open period
 * filled from finer levels and aggregated up (one `now` for both, so a period can't be open in
 * one and closed in the other). The last completed period, backfilled from a finer level, is
 * used only where the coarse response lacks it (its rollup hasn't run yet); it is complete data,
 * so not partial. A place a response leaves out has no data: an empty series.
 *
 * `opts` (totals, completeness) is for monitor targets only: bulk endpoints return means, and
 * summing them would be wrong.
 */
export async function summarySeries(
	req: AdapterRequest,
	places: Place[],
	processors: Array<string | null>,
	signal: AbortSignal,
	opts?: SummaryOptions
): Promise<Series[]> {
	const { target, entryType, now } = req;
	// Bulk (region) endpoints return means, so only a monitor target reads sums.
	const how = opts?.total && target.kind === "monitors" ? "sum" : "mean";
	const segments = planSegments({
		resolution: req.resolution,
		range: req.range,
		now,
		offered: req.offered
	});
	const regionIds = target.kind === "regions" ? places.map((p) => p.id) : undefined;

	// Tasks for a segment; `only` limits monitors to some ids (bulk requests can't be limited).
	const tasksFor = (seg: Segment, only?: Set<string>): FetchTask[] => {
		const chosen = only ? places.filter((p) => only.has(p.id)) : places;
		const procs = chosen.map((p) => processors[places.indexOf(p)]);
		if (seg.resolution === "raw") {
			return chosen.flatMap((p, i) =>
				rawTasks(p.id, entryType, procs[i], seg.start, seg.end, signal)
			);
		}
		// Monitors one by one, each with its own published series: the bulk monitor endpoint
		// can't be scoped to monitor ids, so it is used only for the whole layer.
		if (target.kind === "monitors") {
			return chosen.flatMap((p, i) =>
				monitorSummaryTasks(p.id, entryType, procs[i], seg, now, signal, opts)
			);
		}
		return bulkSummaryTasks(entryType, regionIds, seg, now, signal);
	};
	// Complete and fill together; the backfill waits to see which places lack the last period.
	const [complete, fill] = await collect(
		[
			segments.filter((s) => !s.aggregateTo).flatMap((s) => tasksFor(s)),
			segments.filter((s) => s.aggregateTo && !s.backfill).flatMap((s) => tasksFor(s))
		],
		signal
	);
	const to = req.resolution as Period;
	const knownIds = (): string[] =>
		target.kind === "all"
			? [...new Set([...complete.keys(), ...fill.keys()])]
			: places.map((p) => p.id);

	const backfill = new Map<string, SeriesPoint[]>();
	const seg = segments.find((s) => s.backfill);
	if (seg) {
		const lastT = periodStart(seg.start, to).getTime();
		const lacking = (byId: Map<string, SeriesPoint[]>, t: number, ids: string[]) =>
			ids.filter((id) => !(byId.get(id) ?? []).some((p) => p.t === t));
		const ids = knownIds();
		// With nothing known (a whole-layer response that is empty) the backfill still runs.
		const need = ids.length === 0 ? [] : lacking(complete, lastT, ids);
		if (ids.length === 0 || need.length > 0) {
			const needed = new Set(need);
			const [first] = await collect(
				[tasksFor(seg, target.kind === "monitors" ? needed : undefined)],
				signal
			);
			const take = (id: string) => ids.length === 0 || needed.has(id);
			for (const [id, pts] of first) if (take(id)) backfill.set(id, pts);

			// The backfill's own last sub-period may lack its rollup too: one level finer.
			const finer = finerLevel(seg.resolution, req.offered);
			if (finer) {
				const subStart = periodStart(new Date(seg.end.getTime() - 1), seg.resolution as Period);
				const sub: Segment = { ...seg, resolution: finer, start: subStart };
				const subIds = ids.length === 0 ? [...first.keys()] : need;
				const short = lacking(first, subStart.getTime(), subIds);
				if (short.length > 0) {
					const [extra] = await collect(
						[tasksFor(sub, target.kind === "monitors" ? new Set(short) : undefined)],
						signal
					);
					const shortSet = new Set(short);
					for (const [id, pts] of extra) {
						if (!shortSet.has(id)) continue;
						backfill.set(id, [...(backfill.get(id) ?? []), ...pts]);
					}
				}
			}
		}
	}

	const all =
		target.kind === "all"
			? [...new Set([...complete.keys(), ...fill.keys(), ...backfill.keys()])].map((id) => ({
					place: `monitor:${id}`,
					id
				}))
			: places;
	return all.map(({ place, id }) => {
		const coarse = complete.get(id) ?? [];
		const have = new Set(coarse.map((p) => p.t));
		const missing = aggregate(backfill.get(id) ?? [], to, now, how).filter((p) => !have.has(p.t));
		return {
			place,
			points: [...coarse, ...missing, ...aggregate(fill.get(id) ?? [], to, now, how)].sort(
				(a, b) => a.t - b.t
			)
		};
	});
}

/**
 * Daily summaries, each day point also carrying its worst hourly average when asked: the same
 * query run again at hour resolution (a failure fails the whole query, never partial data).
 */
async function summarySeriesWithWorstHour(
	req: AdapterRequest,
	places: Place[],
	processors: Array<string | null>,
	signal: AbortSignal
): Promise<Series[]> {
	if (!req.worstHour || req.resolution !== "day") {
		return summarySeries(req, places, processors, signal);
	}
	const hourlyReq: AdapterRequest = {
		...req,
		resolution: "hour",
		worstHour: false,
		offered: req.offered.filter((r) => r === "raw" || r === "hour")
	};
	const [daily, hourly] = await Promise.all([
		summarySeries(req, places, processors, signal),
		summarySeries(hourlyReq, places, processors, signal)
	]);
	const hourlyByPlace = new Map(hourly.map((s) => [s.place, s.points]));
	return daily.map((series) => {
		const worst = worstHours(hourlyByPlace.get(series.place) ?? []);
		return {
			place: series.place,
			points: series.points.map((p) => {
				const w = worst.get(p.t);
				return w ? { ...p, worstHour: w } : p;
			})
		};
	});
}

async function fetchTarget(
	req: AdapterRequest,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<QueryData> {
	if (req.target.kind === "fallback") throw new Error("A fallback is fetched one key at a time");
	const [{ places, info }, processors] = await Promise.all([
		placesOf(req.target, ctx, signal),
		placeProcessors(req, ctx, signal)
	]);
	// The series used: shared by every selected monitor, or `null` when they differ (or bulk).
	const processor =
		processors.length > 0 && processors.every((p) => p === processors[0]) ? processors[0] : null;
	const series =
		req.resolution === "raw" || req.downsampleFromRaw
			? await rawSeries(req, places, processors, signal)
			: await summarySeriesWithWorstHour(req, places, processors, signal);
	let placeInfo = info;
	if (req.target.kind === "all") {
		const monitors = await ctx.metadata.monitors(signal);
		const names = new Map(monitors.map((m) => [m.id, m.name]));
		placeInfo = series.map((s) => ({
			place: s.place,
			name: names.get(s.place.slice("monitor:".length)) ?? s.place.slice("monitor:".length)
		}));
	}
	return {
		series,
		places: placeInfo,
		resolution: req.resolution,
		fromRaw: req.downsampleFromRaw,
		processor,
		fetchedAt: req.now.getTime()
	};
}

/**
 * A point's or a school's data: its candidate regions fetched in order, each through the region
 * path (the same request units), stopping at the first with any point in the range; the last
 * candidate's (empty) data when none has any. `key` is the region used. One series, never several.
 */
export async function fallbackFetch(
	req: AdapterRequest,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<{ key: string; data: QueryData }> {
	const { target } = req;
	if (target.kind !== "fallback") throw new Error("Not a fallback target");
	let used: { key: string; data: QueryData } | undefined;
	for (const key of target.keys) {
		const data = await fetchTarget(
			{ ...req, target: { kind: "regions", keys: [key] } },
			ctx,
			signal
		);
		used = { key, data };
		if (data.series.some((s) => s.points.length > 0)) break;
	}
	if (!used) throw new Error("A fallback target has no regions");
	return used;
}

async function fetchAirQuality(
	req: AdapterRequest,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<QueryData> {
	const { target } = req;
	if (target.kind !== "fallback") return fetchTarget(req, ctx, signal);
	const { data } = await fallbackFetch(req, ctx, signal);
	return { ...data, places: data.places.map((p) => ({ ...p, via: target.via })) };
}

/** SJVAir's monitors and regions, through `@sjvair/sdk`; always the published series. */
export const airQualityAdapter: DatasetAdapter = {
	id: "air-quality",
	target: (layer, ctx) => layerTarget(layer, ctx),
	// Regions (and so points and schools) and the whole layer have no raw entries.
	offered: (base, target) => (target.kind === "monitors" ? base : base.filter((r) => r !== "raw")),
	// No overlays yet: its temperature and humidity are raw-only, which regions can't serve, and
	// have no scale to draw as bands (they wait for the weather summaries).
	fetch: fetchAirQuality
};
