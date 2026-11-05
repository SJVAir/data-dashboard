import { getForecastForPlace } from "@sjvair/sdk";
import { pacificDay, todayPacific } from "$lib/format";
import { calendarUnits } from "../chunks";
import { levelFor, type Level } from "../metadata";
import type { PlaceInfo, QueryData, Series, SeriesPoint, Target } from "../types";
import type { AdapterContext, AdapterRequest, DatasetAdapter } from "./registry";
import { layerTarget, regionPlace, resolveRegionKeys, splitRegionKey } from "./targets";

type PlaceRef = Parameters<typeof getForecastForPlace>[0];
type Forecast = Awaited<ReturnType<typeof getForecastForPlace>>["forecasts"][number];

/** A place asked about: its series key, what to ask the server, and the keys behind it. */
type Candidate = { place: string; ref: PlaceRef };

function isNotFound(error: unknown): boolean {
	const cause = error instanceof Error ? (error.cause as { result?: { status?: number } }) : null;
	return cause?.result?.status === 404;
}

function regionRef(key: string): PlaceRef {
	const { type, code } = splitRegionKey(key);
	return { region: { type: type as never, external_id: code } };
}

/** The latest issue for each forecast date. */
function latestIssues(forecasts: Forecast[]): Forecast[] {
	const byDate = new Map<string, Forecast>();
	for (const f of forecasts) {
		const have = byDate.get(f.forecast_date);
		const newer =
			!have ||
			f.issued_date > have.issued_date ||
			(f.issued_date === have.issued_date && f.published_at > have.published_at);
		if (newer) byDate.set(f.forecast_date, f);
	}
	return [...byDate.values()];
}

/** One day point per forecast (see `SeriesPoint.level`); none when the scale has no match. */
function toPoints(
	forecasts: Forecast[],
	entryType: string,
	levels: Level[],
	from: number,
	to: number
): SeriesPoint[] {
	const points: SeriesPoint[] = [];
	for (const f of latestIssues(forecasts)) {
		const t = pacificDay(f.forecast_date).getTime();
		if (!(t >= from && t < to)) continue;
		let value = NaN;
		let level: Level | undefined;
		if (entryType === "burn-status") {
			level = levels.find((l) => l.value === f.burn_status);
		} else {
			value = f.aqi_value;
			level = Number.isFinite(value) ? levelFor(levels, value) : undefined;
		}
		if (!level) continue;
		points.push({
			t,
			mean: value,
			min: value,
			max: value,
			count: 1,
			partial: false,
			level: level.key
		});
	}
	return points.sort((a, b) => a.t - b.t);
}

/** The places to ask about, each with the server reference to try (a fallback has several). */
async function candidates(
	target: Target,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<{ groups: Candidate[][]; info: PlaceInfo[] }> {
	if (target.kind === "monitors") {
		const monitors = await ctx.metadata.monitors(signal);
		const names = new Map(monitors.map((m) => [m.id, m.name]));
		const place = (id: string) => `monitor:${id}`;
		return {
			groups: target.ids.map((id) => [{ place: place(id), ref: { monitor: id } }]),
			info: target.ids.map((id) => ({ place: place(id), name: names.get(id) ?? id }))
		};
	}
	if (target.kind === "all") return { groups: [], info: [] };
	const found = await resolveRegionKeys(target.keys, ctx.regions, signal);
	const named = target.keys.map((key, i) => {
		const region = found[i];
		if (region === null) throw new Error(`Region ${key} can't be looked up`);
		return { key, region };
	});
	const candidate = (key: string): Candidate => ({
		place: regionPlace(key),
		ref: regionRef(key)
	});
	const info = (n: (typeof named)[number]): PlaceInfo => ({
		place: regionPlace(n.key),
		name: n.region.name,
		...(n.region.retired && { retired: n.region.retired })
	});
	if (target.kind === "fallback") {
		// Any region maps to a forecast zone, so the first key answers; later keys only stand in
		// for one the server doesn't know.
		return {
			groups: [named.map((n) => candidate(n.key))],
			info: [info(named[0])]
		};
	}
	return { groups: named.map((n) => [candidate(n.key)]), info: named.map(info) };
}

/** A place's forecasts, month by month (whole calendar months, so requests cache well). */
async function placeForecasts(
	ref: PlaceRef,
	req: AdapterRequest,
	signal: AbortSignal
): Promise<Forecast[]> {
	const units = calendarUnits({ resolution: "day", start: req.range.start, end: req.range.end });
	const months = await Promise.all(
		units.map((unit) =>
			getForecastForPlace(
				ref,
				{
					gte: todayPacific(unit.fetchStart),
					lte: todayPacific(new Date(unit.fetchEnd.getTime() - 1))
				},
				{ signal }
			)
		)
	);
	return months.flatMap((m) => m.forecasts);
}

async function fetchForecasts(
	req: AdapterRequest,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<QueryData> {
	const { target, entryType, range } = req;
	const [{ groups, info }, levels] = await Promise.all([
		candidates(target, ctx, signal),
		ctx.metadata.datasetLevels("forecasts", entryType, signal)
	]);
	const from = range.start.getTime();
	const to = range.end.getTime();
	const series: Series[] = await Promise.all(
		groups.map(async (group) => {
			let used = group[0];
			for (const candidate of group) {
				used = candidate;
				try {
					const forecasts = await placeForecasts(candidate.ref, req, signal);
					return {
						place: candidate.place,
						points: toPoints(forecasts, entryType, levels, from, to)
					};
				} catch (error) {
					// "No such region": no forecasts for this place (a fallback tries its next key).
					if (!isNotFound(error)) throw error;
				}
			}
			return { place: used.place, points: [] };
		})
	);
	const places =
		target.kind === "fallback"
			? info.map((p, i) => ({ ...p, place: series[i].place, via: target.via }))
			: info;
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
 * The air district's burn status and AQI forecast for a place's forecast zone, one day point per
 * forecast date (the latest issue). Any place maps to a zone server-side, so a point or a
 * school asks with its first region key.
 */
export const forecastsAdapter: DatasetAdapter = {
	id: "forecasts",
	async target(layer, ctx) {
		const target = await layerTarget(layer, ctx);
		return "unavailable" in target || target.kind !== "all"
			? target
			: { unavailable: "place-unsupported" };
	},
	offered: () => ["day"],
	fetch: fetchForecasts
};
