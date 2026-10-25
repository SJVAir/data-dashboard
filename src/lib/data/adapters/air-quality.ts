import { periodStart, type Period } from "$lib/format/range";
import { aggregate } from "../aggregate";
import { runLimited } from "../chunks";
import { downsampleInWorker } from "../downsample-client";
import { planSegments } from "../periods";
import type { QueryData, Series, SeriesPoint, Target } from "../types";
import {
	bulkSummaryTasks,
	monitorSummaryTasks,
	rawTasks,
	type Fetched,
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
): Promise<Place[]> {
	if (target.kind === "monitors") return target.ids.map((id) => ({ place: `monitor:${id}`, id }));
	if (target.kind === "all") return [];
	const ids = await resolveRegionKeys(target.keys, ctx.regions, signal);
	return target.keys.map((key, i) => {
		const id = ids[i];
		if (id === null) throw new Error(`Region ${key} can't be looked up`);
		return { place: regionPlace(key), id };
	});
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
 */
async function summarySeries(
	req: AdapterRequest,
	places: Place[],
	processors: Array<string | null>,
	signal: AbortSignal
): Promise<Series[]> {
	const { target, entryType, now } = req;
	const segments = planSegments({
		resolution: req.resolution,
		range: req.range,
		now,
		offered: req.offered
	});
	const regionIds = target.kind === "regions" ? places.map((p) => p.id) : undefined;

	const tasksFor = (seg: (typeof segments)[number]): FetchTask[] => {
		if (seg.resolution === "raw") {
			return places.flatMap((p, i) =>
				rawTasks(p.id, entryType, processors[i], seg.start, seg.end, signal)
			);
		}
		// Monitors one by one, each with its own published series: the bulk monitor endpoint
		// can't be scoped to monitor ids, so it is used only for the whole layer.
		if (target.kind === "monitors") {
			return places.flatMap((p, i) =>
				monitorSummaryTasks(p.id, entryType, processors[i], seg, now, signal)
			);
		}
		return bulkSummaryTasks(entryType, regionIds, seg, now, signal);
	};
	const [complete, fill, backfill] = await collect(
		[
			segments.filter((s) => !s.aggregateTo).flatMap(tasksFor),
			segments.filter((s) => s.aggregateTo && !s.backfill).flatMap(tasksFor),
			segments.filter((s) => s.backfill).flatMap(tasksFor)
		],
		signal
	);

	const to = req.resolution as Period;
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
		const missing = aggregate(backfill.get(id) ?? [], to, now).filter((p) => !have.has(p.t));
		return {
			place,
			points: [...coarse, ...missing, ...aggregate(fill.get(id) ?? [], to, now)].sort(
				(a, b) => a.t - b.t
			)
		};
	});
}

async function fetchAirQuality(
	req: AdapterRequest,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<QueryData> {
	const [places, processors] = await Promise.all([
		placesOf(req.target, ctx, signal),
		placeProcessors(req, ctx, signal)
	]);
	// The series used: shared by every selected monitor, or `null` when they differ (or bulk).
	const processor =
		processors.length > 0 && processors.every((p) => p === processors[0]) ? processors[0] : null;
	const series =
		req.resolution === "raw" || req.downsampleFromRaw
			? await rawSeries(req, places, processors, signal)
			: await summarySeries(req, places, processors, signal);
	return {
		series,
		resolution: req.resolution,
		fromRaw: req.downsampleFromRaw,
		processor,
		fetchedAt: req.now.getTime()
	};
}

/** SJVAir's monitors and regions, through `@sjvair/sdk`; always the published series. */
export const airQualityAdapter: DatasetAdapter = {
	id: "air-quality",
	target: (layer, ctx) => layerTarget(layer, ctx.regions),
	// Regions and the whole layer have no raw entries.
	offered: (base, target) => (target.kind === "monitors" ? base : base.filter((r) => r !== "raw")),
	fetch: fetchAirQuality
};
