import { getForecastForPlace } from "@sjvair/sdk";
import { pacificDay, todayPacific } from "$lib/format";
import { calendarUnits } from "../chunks";
import { levelFor, type Level } from "../metadata";
import type { PlaceInfo, QueryData, Series, SeriesPoint, Target } from "../types";
import type { AdapterContext, AdapterRequest, DatasetAdapter } from "./registry";
import { layerTarget, regionPlace, resolveRegionKeys, splitRegionKey } from "./targets";

type PlaceRef = Parameters<typeof getForecastForPlace>[0];
type Forecast = Awaited<ReturnType<typeof getForecastForPlace>>["forecasts"][number];

/** A place asked about: what to ask the server, and the place it names (its series key too). */
type Candidate = { ref: PlaceRef; info: PlaceInfo };

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
		// Each entry type reads its own field of the forecast row, so this keys off the id: burn
		// status is a category (its scale's levels carry the `value` it matches), AQI a number.
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

/** The places to ask about, each with the server references to try (a fallback has several). */
async function candidates(
	target: Target,
	ctx: AdapterContext,
	signal: AbortSignal
): Promise<Candidate[][]> {
	if (target.kind === "monitors") {
		const monitors = await ctx.metadata.monitors(signal);
		const names = new Map(monitors.map((m) => [m.id, m.name]));
		return target.ids.map((id) => [
			{ ref: { monitor: id }, info: { place: `monitor:${id}`, name: names.get(id) ?? id } }
		]);
	}
	if (target.kind === "all") return [];
	const found = await resolveRegionKeys(target.keys, ctx.regions, signal);
	const named = target.keys.map((key, i): Candidate => {
		const region = found[i];
		if (region === null) throw new Error(`Region ${key} can't be looked up`);
		return {
			ref: regionRef(key),
			info: {
				place: regionPlace(key),
				name: region.name,
				...(region.retired && { retired: region.retired })
			}
		};
	});
	// Any region maps to a forecast zone, so a fallback's first key answers; later keys only stand
	// in for one the server doesn't know.
	return target.kind === "fallback" ? [named] : named.map((c) => [c]);
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
	const [groups, levels] = await Promise.all([
		candidates(target, ctx, signal),
		ctx.metadata.datasetLevels("forecasts", entryType, signal)
	]);
	const from = range.start.getTime();
	const to = range.end.getTime();
	// Each place's series and its name, from the candidate that answered (the last when none did).
	const answers = await Promise.all(
		groups.map(async (group) => {
			for (const candidate of group) {
				try {
					const forecasts = await placeForecasts(candidate.ref, req, signal);
					const points = toPoints(forecasts, entryType, levels, from, to);
					return { info: candidate.info, points };
				} catch (error) {
					// "No such region": no forecasts for this place (a fallback tries its next key).
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
	// One value per day, with levels: each entry type draws as day bands on any pollutant.
	overlays: () => true,
	fetch: fetchForecasts
};
