import { getSmokeForPlace } from "@sjvair/sdk";
import { pacificDay, todayPacific } from "$lib/format";
import { splitChunks } from "../chunks";
import type { Level } from "../metadata";
import type { QueryData, Series, SeriesPoint } from "../types";
import type { AdapterContext, AdapterRequest, DatasetAdapter } from "./registry";
import { isNotFound, layerTarget, placeCandidates, type PlaceRef } from "./targets";

/** The server's most days per smoke request. */
const MAX_DAYS = 366;

type Day = Awaited<ReturnType<typeof getSmokeForPlace>>["days"][number];

/** One day point per day with a density the scale lists (see `SeriesPoint.level`). */
function toPoints(days: Day[], levels: Level[], from: number, to: number): SeriesPoint[] {
	const keys = new Set(levels.map((l) => l.key));
	const byDay = new Map<number, SeriesPoint>();
	for (const day of days) {
		// A null density is a day with no band.
		if (day.density === null || !keys.has(day.density)) continue;
		const t = pacificDay(day.date).getTime();
		if (!(t >= from && t < to)) continue;
		byDay.set(t, {
			t,
			mean: NaN,
			min: NaN,
			max: NaN,
			count: 1,
			partial: false,
			level: day.density
		});
	}
	return [...byDay.values()].sort((a, b) => a.t - b.t);
}

/** A place's smoke days, in requests of at most 366 days that join without a gap or overlap. */
async function placeSmoke(ref: PlaceRef, req: AdapterRequest, signal: AbortSignal): Promise<Day[]> {
	const chunks = splitChunks(
		{ resolution: "day", start: req.range.start, end: req.range.end },
		MAX_DAYS
	);
	const responses = await Promise.all(
		chunks.map((chunk) =>
			getSmokeForPlace(
				ref,
				{
					gte: todayPacific(chunk.start),
					lte: todayPacific(new Date(chunk.end.getTime() - 1))
				},
				{ signal }
			)
		)
	);
	return responses.flatMap((r) => r.days);
}

async function fetchSmoke(
	req: AdapterRequest,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<QueryData> {
	const { target, entryType, range } = req;
	const [groups, levels] = await Promise.all([
		placeCandidates(target, ctx, signal),
		ctx.metadata.datasetLevels("hms-smoke", entryType, signal)
	]);
	const from = range.start.getTime();
	const to = range.end.getTime();
	// Each place's series and its name, from the candidate that answered (the last when none did).
	const answers = await Promise.all(
		groups.map(async (group) => {
			for (const candidate of group) {
				try {
					const days = await placeSmoke(candidate.ref, req, signal);
					return { info: candidate.info, points: toPoints(days, levels, from, to) };
				} catch (error) {
					// "No such region": no smoke data for this place (a fallback tries its next key).
					if (!isNotFound(error)) throw error;
				}
			}
			return { info: group[group.length - 1].info, points: [] };
		})
	);
	const series: Series[] = answers.map((a) => ({ place: a.info.place, points: a.points }));
	const places = answers.map((a) =>
		target.kind === "fallback" ? { ...a.info, via: target.via } : a.info
	);
	return {
		series,
		places,
		resolution: "day",
		fromRaw: false,
		processor: null,
		fetchedAt: req.now.getTime()
	};
}

/**
 * NOAA's smoke density for a place, one day point per day with smoke (`level` = the density key).
 * Any place maps to regions server-side, so a point or a school asks with its first region key.
 */
export const smokeAdapter: DatasetAdapter = {
	id: "hms-smoke",
	async target(layer, ctx) {
		const target = await layerTarget(layer, ctx);
		return "unavailable" in target || target.kind !== "all"
			? target
			: { unavailable: "place-unsupported" };
	},
	offered: () => ["day"],
	// One density per day: draws as day bands on any pollutant.
	overlays: () => true,
	fetch: fetchSmoke
};
