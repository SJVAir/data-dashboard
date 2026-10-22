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
 * The processor of the published series for a single monitor (its type's default calibration),
 * which the single-monitor endpoints need named; bulk endpoints return it by default.
 */
async function publishedProcessor(
	req: AdapterRequest,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<string | null> {
	const { target } = req;
	if (target.kind !== "monitors" || target.ids.length !== 1) return null;
	const type = await ctx.metadata.monitorType(target.ids[0], signal);
	return type === null ? null : ctx.metadata.defaultProcessor(type, req.entryType, signal);
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

/** Raw entries for each monitor over the range so far. */
function rawFetch(req: AdapterRequest, places: Place[], signal: AbortSignal) {
	const { range, now } = req;
	const end = new Date(Math.min(range.end.getTime(), now.getTime()));
	const tasks = places.flatMap((p) => rawTasks(p.id, req.entryType, range.start, end, now, signal));
	return collect([tasks], signal).then(([byId]) => byId);
}

/** Raw entries as they are, or downsampled (in a worker) to the requested resolution. */
async function rawSeries(
	req: AdapterRequest,
	places: Place[],
	signal: AbortSignal
): Promise<Series[]> {
	if (req.target.kind !== "monitors") throw new Error("Raw entries exist only for monitors");
	const byId = await rawFetch(req, places, signal);
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
 * one and closed in the other). A place a bulk response leaves out has no data: an empty series.
 */
async function summarySeries(
	req: AdapterRequest,
	places: Place[],
	processor: string | null,
	signal: AbortSignal
): Promise<Series[]> {
	const { target, entryType, now } = req;
	const segments = planSegments({
		resolution: req.resolution,
		range: req.range,
		now,
		offered: req.offered
	});
	const single = target.kind === "monitors" && target.ids.length === 1;
	const regionIds = target.kind === "regions" ? places.map((p) => p.id) : undefined;

	const tasksFor = (seg: (typeof segments)[number]): FetchTask[] => {
		if (seg.resolution === "raw") {
			return places.flatMap((p) => rawTasks(p.id, entryType, seg.start, seg.end, now, signal));
		}
		if (single) return monitorSummaryTasks(places[0].id, entryType, processor, seg, now, signal);
		return bulkSummaryTasks(entryType, regionIds, seg, now, signal);
	};
	const [complete, fill] = await collect(
		[
			segments.filter((s) => !s.aggregateTo).flatMap(tasksFor),
			segments.filter((s) => s.aggregateTo).flatMap(tasksFor)
		],
		signal
	);

	const all =
		target.kind === "all"
			? [...new Set([...complete.keys(), ...fill.keys()])].map((id) => ({
					place: `monitor:${id}`,
					id
				}))
			: places;
	return all.map(({ place, id }) => ({
		place,
		points: [
			...(complete.get(id) ?? []),
			...aggregate(fill.get(id) ?? [], req.resolution as Period, now)
		].sort((a, b) => a.t - b.t)
	}));
}

async function fetchAirQuality(
	req: AdapterRequest,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<QueryData> {
	const [places, processor] = await Promise.all([
		placesOf(req.target, ctx, signal),
		publishedProcessor(req, ctx, signal)
	]);
	const series =
		req.resolution === "raw" || req.downsampleFromRaw
			? await rawSeries(req, places, signal)
			: await summarySeries(req, places, processor, signal);
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
